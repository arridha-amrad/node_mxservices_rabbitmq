import dotenv from "dotenv";
dotenv.config();
import "reflect-metadata";

import express, { Request, Response } from "express";
import cors from "cors";
import { createConnection } from "typeorm";
import { Product } from "./entity/product";
import amqp from "amqplib/callback_api";
import queue from "./queue.json";

createConnection().then((db) => {
  //! checking connection to mysql
  console.log("connected to mysql");

  const productRepo = db.getRepository(Product);

  // spell:disable

  amqp.connect(
    "amqps://mtxzriic:DlZJ88yPXSjorY6HC5bTsaRwZ0V8Oq0g@cattle.rmq2.cloudamqp.com/mtxzriic",
    (error0, connection) => {
      if (error0) {
        console.log(error0);

        throw error0;
      }
      connection.createChannel((error1, channel) => {
        if (error1) {
          throw error1;
        }

        //! checking connection to RabbitMQ
        console.log("Channel to RabbitMQ is created");

        const app = express();
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

        app.get("/api/products", async (req: Request, res: Response) => {
          try {
            const products = await productRepo.find();
            return res.status(200).send(products);
          } catch (error) {
            console.log(error);
          }
        });

        app.get("/api/product/:id", async (req: Request, res: Response) => {
          try {
            const product = await productRepo.findOne(req.params.id);
            return res.status(200).send(product);
          } catch (error) {
            console.log(error);
          }
        });

        app.post("/api/products", async (req: Request, res: Response) => {
          try {
            const newProduct = productRepo.create(req.body);
            const result = await productRepo.save(newProduct);
            channel.sendToQueue(
              queue.productCreated,
              Buffer.from(JSON.stringify(result))
            );
            return res.status(200).send(result);
          } catch (error) {
            console.log(error);
          }
        });

        app.put("/api/product/:id", async (req: Request, res: Response) => {
          try {
            const existingProduct = await productRepo.findOne(req.params.id);
            if (existingProduct) {
              const result = productRepo.merge(existingProduct, req.body);
              const savedProduct = await productRepo.save(result);
              channel.sendToQueue(
                queue.productUpdated,
                Buffer.from(JSON.stringify(savedProduct))
              );
              return res.status(200).send(savedProduct);
            }
          } catch (error) {
            console.log(error);
          }
        });

        app.delete("/api/product/:id", async (req: Request, res: Response) => {
          try {
            await productRepo.delete(req.params.id);
            channel.sendToQueue(
              queue.productDeleted,
              Buffer.from(req.params.id)
            );
            return res.status(200).send("delete successfully");
          } catch (error) {
            console.log(error);
          }
        });

        app.post(
          "/api/product/:id/like",
          async (req: Request, res: Response) => {
            try {
              const product = await productRepo.findOne(req.params.id);
              if (product) {
                product.likes += 1;
                const result = await productRepo.save(product);
                channel.sendToQueue(
                  queue.productLiked,
                  Buffer.from(JSON.stringify(result))
                );
                return res.status(200).send(result);
              }
            } catch (error) {
              console.log(error);
            }
          }
        );

        const PORT = process.env.PORT || "5001";

        app.listen(PORT, () => {
          //! checking connection to server
          console.log(`server running from port ${PORT}`);
        });
        process.on("beforeExit", () => {
          console.log("rabbitMQ connection is closed");
          connection.close();
        });
      });
    }
  );
});
