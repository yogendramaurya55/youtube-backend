import dotenv from "dotenv"
import connectDB from "./db/db.js";
import {app} from "./app.js"

dotenv.config({
    path: "./env"
})


connectDB()
.then(()=>{
    app.listen(process.env.PORT || 8000, ()=>{
        console.log(`server started at pot : ${process.env.PORT}` )
    })
})
.catch((err)=>{
    console.log("Mongo db connection falied !!! ", err);
})
