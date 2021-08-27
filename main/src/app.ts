import dotenv from "dotenv";
dotenv.config();

import "reflect-metadata";

import express, { Request, Response } from "express";
import cors from "cors";
import { createConnection } from "typeorm";
import amqp from "amqplib/callback_api";
import queue from "./queue.json";
import { Product } from "./entity/product";
import axios from "axios";

const app = express();
const PORT = process.env.PORT || "6000";

createConnection().then((db) => {
  const productRepo = db.getRepository(Product);

  //! checking connection to mysql
  console.log("connected to mongoDB");

  // spell:disable
  amqp.connect(
    "amqps://mtxzriic:DlZJ88yPXSjorY6HC5bTsaRwZ0V8Oq0g@cattle.rmq2.cloudamqp.com/mtxzriic",
    (err0, connection) => {
      if (err0) {
        throw err0;
      }
      connection.createChannel((err1, channel) => {
        if (err1) {
          throw err1;
        }

        //! checking connection to RabbitMQ
        console.log("Channel to RabbitMQ is created");

        channel.assertQueue(queue.productCreated, { durable: false });
        channel.assertQueue(queue.productDeleted, { durable: false });
        channel.assertQueue(queue.productUpdated, { durable: false });
        channel.assertQueue(queue.productLiked, { durable: false });

        app.use(
          cors({
            origin: [
              process.env.REACT_ORIGIN ?? "",
              process.env.VUE_ORIGIN ?? "",
              process.env.ANGULAR_ORIGIN ?? "",
            ],
          })
        );

        app.use(express.json());

        channel.consume(
          queue.productCreated,
          async (data) => {
            const product: Product = JSON.parse(data?.content.toString() ?? "");
            const newProduct = new Product();
            newProduct.admin_id = parseInt(product.id);
            newProduct.title = product.title;
            newProduct.image = product.image;
            newProduct.likes = product.likes;
            await productRepo.save(newProduct);
            console.log("new product added to mongoDB");
          },
          { noAck: true }
        );

        channel.consume(
          queue.productUpdated,
          async (data) => {
            const product: Omit<Product, "admin_id"> = JSON.parse(
              data?.content.toString() ?? ""
            );
            const existingProduct = await productRepo.findOne({
              where: { admin_id: product.id },
            });

            if (existingProduct) {
              const updatedProduct = productRepo.merge(existingProduct, {
                title: product.title,
                image: product.image,
                likes: product.likes,
              });
              await productRepo.save(updatedProduct);
              console.log("product updated");
            }
          },
          { noAck: true }
        );

        channel.consume(
          queue.productDeleted,
          async (msg) => {
            const id = msg?.content.toString();
            await productRepo.delete({ admin_id: parseInt(id ?? "") });
            console.log("product deleted");
          },
          { noAck: true }
        );

        channel.consume(
          queue.productLiked,
          async (msg) => {
            const product: Omit<Product, "admin_id"> = JSON.parse(
              msg?.content.toString() ?? ""
            );
            const existingProduct = await productRepo.findOne({
              admin_id: parseInt(product.id),
            });
            if (existingProduct) {
              existingProduct.likes = product.likes;
              await productRepo.save(existingProduct);
              console.log("product liked");
            }
          },
          { noAck: true }
        );

        app.post(
          "/api/product/:id/like",
          async (req: Request, res: Response) => {
            const product = await productRepo.findOne({
              admin_id: parseInt(req.params.id),
            });
            const result = await axios.post(
              `http://localhost:5001/api/product/${req.params.id}/like`,
              {}
            );
            if (product && result.data) {
              product.likes += 1;
              console.log("product liked");
            }
            return res.status(200).send(product);
          }
        );

        app.listen(PORT, () => {
          //! checking connection to server
          console.log(`Server up and running from ${PORT}`);
        });
        process.on("beforeExit", () => {
          console.log("connection to rabbitMQ is closed");
          connection.close();
        });
      });
    }
  );
});
