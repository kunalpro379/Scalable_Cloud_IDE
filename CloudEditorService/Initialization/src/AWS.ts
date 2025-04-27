import { S3 } from "aws-sdk"
import fs from "fs";
import path from "path";

const s3 = new S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.S3_ENDPOINT
})


export const languageEnvironments={
    nodejs: {
        image : "node:18-alpine",
        templateFolder: "templates/nodejs",
        initCommand: "cd /workspace && npm install",
        runCommand: "cd /workspace && npm start",
        defaultPort: 3000,
    },
    python: {
        image: "python:3.11-slim",
        templateFolder: "templates/python",
        initCommand: "cd /workspace && pip install -r requirements.txt",
        runCommand: "cd /workspace && python main.py",
        defaultPort: 8000,
    },
    java: {
        image: "eclipse-temurin:17-jdk-alpine",
        templateFolder: "templates/java",
        initCommand: "cd /workspace && javac Main.java",
        runCommand: "cd /workspace && java Main",
        defaultPort: 8080
    },
    cpp: {
        image: "gcc:12.2.0",
        templateFolder: "templates/cpp",
        initCommand: "cd /workspace && g++ -o main main.cpp",
        runCommand: "cd /workspace && ./main",
        defaultPort: 8080
    },
    // go: {}
}
export async function setupLanguageEnvironment(cloudId: string, language: string): Promise<boolean>{
    if(!languageEnvironments[language])throw new Error(`Language not supported ${language}`);
    const sourcePrefix=languageEnvironments[language].templateFolder;
    const destinationPrefix=`code/${cloudId}`;
    try{await copyS3Folder(sourcePrefix, destinationPrefix);
        console.log(`Copied ${sourcePrefix} to ${destinationPrefix}`);
        console.log(`Environment setup for ${language} completed for ${cloudId}`);
        return true;

    }catch (error) {
        console.error(`Error setting up environment for ${language}:`, error);
        return false;
    }
}

export function getContainerConfig(cloudId: string, language: string): any{
    if(!languageEnvironments[language])throw new Error(`Unsupported language: ${language}`);
    const env=languageEnvironments[language];
    return {
        cloudId,
        language,
        image: env.image,
        initCommand: env.initCommand,
        port:env.defaultPort,
        runCommand: env.runCommand
    };
}

export async function copyS3Folder(sourcePrefix: string, destinationPrefix: string, continuationToken?: string): Promise<void> {
    try {
        // List all objects in the source folder
        const listParams = {
            Bucket: process.env.S3_BUCKET ?? "",
            Prefix: sourcePrefix,
            ContinuationToken: continuationToken
        };

        const listedObjects = await s3.listObjectsV2(listParams).promise();

        if (!listedObjects.Contents || listedObjects.Contents.length === 0) return;
        
        // Copy each object to the new location
        // We're doing it parallely here, using promise.all()
        await Promise.all(listedObjects.Contents.map(async (object) => {
            if (!object.Key) return;
            let destinationKey = object.Key.replace(sourcePrefix, destinationPrefix);
            let copyParams = {
                Bucket: process.env.S3_BUCKET ?? "",
                CopySource: `${process.env.S3_BUCKET}/${object.Key}`,
                Key: destinationKey
            };

            console.log(copyParams);

            await s3.copyObject(copyParams).promise();
            console.log(`Copied ${object.Key} to ${destinationKey}`);
        }));

        // Check if the list was truncated and continue copying if necessary
        if (listedObjects.IsTruncated) {
            listParams.ContinuationToken = listedObjects.NextContinuationToken;
            await copyS3Folder(sourcePrefix, destinationPrefix, continuationToken);
        }
    } catch (error) {
        console.error('Error copying folder:', error);
    }
}

export const saveToS3 = async (key: string, filePath: string, content: string): Promise<void> => {
    const params = {
        Bucket: process.env.S3_BUCKET ?? "",
        Key: `${key}${filePath}`,
        Body: content
    }

    await s3.putObject(params).promise()
}