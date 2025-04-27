import express from "express";
import dotenv from "dotenv"
import cors from "cors";
import axios from "axios";

dotenv.config()
import { copyS3Folder, getContainerConfig, setupLanguageEnvironment } from "./AWS";


const app = express();
app.use(express.json());
app.use(cors())


const ORCHESTRATION_SERVICE = process.env.ORCHESTRATION_SERVICE || "http://orchestration-service:3000";

app.post("/initialize", async (req, res) => {
    const { cloudId, language, dependencies = [] } = req.body;
    if (!cloudId || !language) {
        res.status(400).send("Bad request");
        return;
    }
    try{
        //copy templates from s3
        await setupLanguageEnvironment(cloudId, language);
        //get container configuration for this language
        const containerConfig=getContainerConfig(cloudId, language);    
        //request container creation from the orchastration service
        const response =await axios.post(`${ORCHESTRATION_SERVICE}/deploy`,{
            ...containerConfig,
            dependencies
        });
        return res.status().json({
            message: "environment initialized successfully",
            cloudId,
            language,
            containerEndpoint: response.data.containerEndpoint,
            initCommand: containerConfig.initCommand
        });
    }catch (error) {
        console.error("Failed to initialize environment:", error);
        return res.status(500).json({
            error: "Failed to initialize environment",
            details: error.message
        });
    }

});

app.get("/status/:cloudId", async (req, res)=>{
    const {cloudId}=req.params;
    try{
        const reponse=await axios.get(`${ORCHESTRATION_SERVICE}/status/${cloudId}`);
        return res.status(200).json(response.data   );
    }catch (error) {
        console.error("Failed to get environment status:", error);
        return res.status(404).json({
            error: "Environment not found or error checking status",
            details: error.message
        });
    }
});


app.post("/project", async (req, res) => {
    // Hit a database to ensure this slug isn't taken already
    const { CloudID, language } = req.body;

    if (!CloudID) {
        res.status(400).send("Bad request");
        return;
    }

    await copyS3Folder(`base/${language}`, `code/${CloudID}`);

    res.send("Project created");
});

const port = process.env.PORT || 3001;

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Initialization service running on port ${PORT}`);
});