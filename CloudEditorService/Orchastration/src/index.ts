import express from "express";
import fs from "fs";
import yaml from "yaml";
import path from "path";
import cors from "cors";
import { exec } from "child_process";
import util from "util";
import { KubeConfig, AppsV1Api, CoreV1Api, NetworkingV1Api } from "@kubernetes/client-node";


const execAsync = util.promisify(exec);

const app = express();
app.use(express.json());
app.use(cors());

const kubeconfig = new KubeConfig();
kubeconfig.loadFromDefault();
const coreV1Api = kubeconfig.makeApiClient(CoreV1Api);
const appsV1Api = kubeconfig.makeApiClient(AppsV1Api);
const networkingV1Api = kubeconfig.makeApiClient(NetworkingV1Api);


app.post("/deploy", async (req, res) => {
const {cloudId, language, image, port =3000, dependencies=[]}=req.body;
if(!cloudId|| !language||!image)return res.status(400).send({message: "Missing required fields"});

const namespace=process.env.K8S_NAMESPACE || "cloud-editor";
try{
    //creating a deployment manifest nfile
    const deployment={
        apiVersion: "apps/v1",
        kind: "Deplopyment",
        metadata: {
            name: `${cloudId}-deployment`,
            namespace: namespace,
            labels:{
                app: `${cloudId}-app`,
                language: language,
            }
        },
        spec:{
            replicas:1,
            selector:{
                matchLabels:{
                    app: `${cloudId}-app`,
                }
            },
            spec:{
                containers:[
                    {
                        name: "code-environment",
                        image: image,
                        command: ["/bin/sh", "-c"], // Command to run the container
                        args:["cd /workspace && tail-f /dev/null"],
                        ports:[
                            {
                                containerPort: port,
                            }
                        ],
                        env: [
                            {
                                name: "CLOUD_ID",
                                value: cloudId,
                            },
                            {
                                name: "LANGUAGE",
                                value: language,
                            },
                            {
                                name: "AWS_ACCESS_KEY_ID",
                                valueFrom: {
                                    secretKeyRef: {
                                        name: "aws-secret",
                                        key: "access-key"
                                    }
                                }
                            },

                            {
                                name: "AWS_SECRET_ACCESS_KEY",
                                valueFrom: {
                                    secretKeyRef: {
                                        name: "aws-secret",
                                        key: "secret-key"
                                    }
                                }
                            },
                            {
                                name: "S3_ENDPOINT",
                                valueFrom: {
                                    configMapKeyRef: {
                                        name: "aws-config",
                                        key: "endpoint"
                                    }
                                }
                            },
                            {
                                name: "S3_BUCKET",
                                valueFrom: {
                                    configMapKeyRef: {
                                        name: "aws-config",
                                        key: "bucket"
                                    }
                                }
                            }
                        ],
                        volumeMounts:[
                            {
                                name: "workspace",
                                mountPath: "/workspace",
                            }
                        ]
                    }
                ],volumes:[{
                    name: "workspace",
                    emptydir: {}    

                }]
            }
        },

    };

    //creating a service manifest file
    const service={
        apiVersion:"v1",
        kind: "Service",
        metadata:{
            name: `${cloudId}-service`, 
            namespace: namespace,
        },
        spec:{
            selector:{app: `${cloudId}-app`},
            ports:[                
                {
                    port: port,
                    targetPort: port,
                    // protocol: "TCP",
                }
            ],
            type: "clusterIP"
        }.

    };
//applying manifests to the cluster
await appsV1Api.createNamespacedDeployment(namespace, deployment);
await coreV1Api.createNamespacedService(namespace, service);
//waiting for the pod to be ready
await waitForPodReady(cloudId, namespace);
//syncing the workspace folder to the pod
await syncS3ToContainer(cloudId, namespace);
//install dependencies if provided
if(dependencies.length>0)await installDependencies(cloudId, language, dependencies,namespace);
//getting the pod name
//
return res.status(200).send({
    message: "Deployment created successfully",
    cloudId: cloudId,
    language: language,
    containerEndpoint: `http://${cloudId}-service.${namespace}.svc.cluster.local:${port}`,
});   
} catch (error) {
    console.error("Error creating deployment:", error);
    res.status(500).send({ message: "Failed to create deployment" });
}
});


// Updated utility function to handle multi-document YAML files
const readAndParseKubeYaml = (filePath: string, CloudID: string): Array<any> => {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const docs = yaml.parseAllDocuments(fileContent).map((doc) => {
        let docString = doc.toString();
        const regex = new RegExp(`service_name`, 'g');
        docString = docString.replace(regex, CloudID);
        console.log(docString);
        return yaml.parse(docString);
    });
    return docs;
};


app.get("/status: cloudId", async(req, res)=>{
    const {cloudId}=req.params;
    const namespace=process.env.KUBE_NAMESPACE || "cloud-editor";
    try{
        const pods=await coreV1Api.listNamespacedPod(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            `app=${cloudId}-app`,

        );
        if(pods.body.items.length===0){return res.status(400).json({
            message: "No pods found",
        });}
        const pod=pods.body.items[0];
        const podStatus=pod.status?.phase;
        return res.status(200).json({
            cloudId: cloudId,
            podName: pod.metadata?.name,
            message: "Pod status fetched successfully",
            podStatus: podStatus,
        });
    }catch(error){  
        console.error("Error fetching pod status:", error);
        return res.status(500).json({
            error: "Failed to get container status",
            details: error.message
        });    }
});

//terminate the pod and associated resources
app.delete("/terminate/:cloudId", async (req, res) => {
    const{cloudId}=req.params;
    const namespace=process.env.KUBE_NAMESPACE || "cloud-editor";   
    try{
        await appsV1Api.deleteNamespacedDeployment(`${cloudId}-deployment`, namespace);
        await coreV1Api.deleteNamespacedService(`${cloudId}-service`, namespace);  
        return res.status(200).json({
            message: "Resources deleted successfully",
        });
    }catch(error){
        console.error("Failed to terminate container:", error);
        return res.status(500).json({
            error: "Failed to terminate container",
            details: error.message
        });
    }
});
async function installDependencies(cloudId: string, language: string, dependencies: string[], namespace: string): Promise<void> {
    try {
        const pods = await coreV1Api.listNamespacedPod(
            namespace, 
            undefined, 
            undefined, 
            undefined, 
            undefined, 
            `app=${cloudId}`
        );
        
        if (pods.body.items.length === 0) {
            throw new Error("Pod not found");
        }
        
        const podName = pods.body.items[0].metadata?.name;
        
        let command: string;
              // Create language-specific install command
              switch (language) {
                case "nodejs":
                    command = `cd /workspace && npm install ${dependencies.join(" ")} --save`;
                    break;
                case "python":
                    command = `cd /workspace && pip install ${dependencies.join(" ")} && pip freeze > requirements.txt`;
                    break;
                case "java":
                    command = `cd /workspace && mvn dependency:get -Dartifact=${dependencies.join(" -Dartifact=")}`;
                    break;
                case "cpp":
                    command = `apt-get update && apt-get install -y ${dependencies.join(" ")}`;
                    break;
                case "go":
                    command = `cd /workspace && go get ${dependencies.join(" ")}`;
                    break;
                default:
                    throw new Error(`Unsupported language: ${language}`);
            }

        
        
        await execAsync(`kubectl -n ${namespace} exec ${podName} -- sh -c "${command}"`);
        
        console.log(`Dependencies installed for ${cloudId}`);
    } catch (error) {
        console.error("Failed to install dependencies:", error);
        throw error;
    }
}




// Helper function to wait for pod to be ready
async function waitForPodReady(cloudId: string, namespace: string): Promise<void> {
    const maxRetries = 30; // Wait up to 30 * 2 seconds = 1 minute
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const pods = await coreV1Api.listNamespacedPod(
                namespace, 
                undefined, 
                undefined, 
                undefined, 
                undefined, 
                `app=${cloudId}`
            );
if (pods.body.items.length > 0) {
    const pod = pods.body.items[0];
    
    if (pod.status?.phase === 'Running') {
        // Check container ready status
        const containerStatuses = pod.status.containerStatuses || [];
        if (containerStatuses.length > 0 && containerStatuses[0].ready) {
            return;
        }
    }
}
} catch (error) {
console.error("Error checking pod status:", error);
}

// Wait 2 seconds before checking again
await new Promise(resolve => setTimeout(resolve, 2000));
}

throw new Error(`Pod for ${cloudId} not ready after ${maxRetries * 2} seconds`);
}

// Helper function to sync files from S3 to container
async function syncS3ToContainer(cloudId: string, namespace: string): Promise<void> {
    try {
        const pods = await coreV1Api.listNamespacedPod(
            namespace, 
            undefined, 
            undefined, 
            undefined, 
            undefined, 
            `app=${cloudId}`
        );
        
        if (pods.body.items.length === 0) {
            throw new Error("Pod not found");
        }
        
        const podName = pods.body.items[0].metadata?.name;
        
        // Create sync script in the container
        const syncScript = `
#!/bin/sh
mkdir -p /workspace
cd /workspace
# Install AWS CLI if not already installed
if ! command -v aws &> /dev/null; then
    echo "Installing AWS CLI..."
    if command -v apt-get &> /dev/null; then
        apt-get update && apt-get install -y curl unzip
    elif command -v apk &> /dev/null; then
        apk add --no-cache curl unzip
    fi
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip awscliv2.zip
    ./aws/install
fi

# Configure AWS CLI
mkdir -p ~/.aws
cat > ~/.aws/credentials << EOF
[default]
aws_access_key_id=${process.env.AWS_ACCESS_KEY_ID}
aws_secret_access_key=${process.env.AWS_SECRET_ACCESS_KEY}
EOF

cat > ~/.aws/config << EOF
[default]
region=us-east-1
endpoint_url=${process.env.S3_ENDPOINT}
EOF

# Sync files from S3
aws s3 sync s3://${process.env.S3_BUCKET}/code/${cloudId}/ /workspace/
echo "Files synced from S3 to workspace"
`;

        // Create script in pod
        await execAsync(`kubectl -n ${namespace} exec ${podName} -- sh -c "mkdir -p /tmp && cat > /tmp/sync.sh << 'EOF'
            ${syncScript}
            EOF
            chmod +x /tmp/sync.sh"`);
                    
                    // Execute script
                    await execAsync(`kubectl -n ${namespace} exec ${podName} -- sh -c "/tmp/sync.sh"`);
                    
                    console.log(`Files synced from S3 to container for ${cloudId}`);
                } catch (error) {
                    console.error("Failed to sync files:", error);
                    throw error;
                }
            }
            
app.post("/start", async (req, res) => {
    const { userId, CloudID } = req.body; // Assume a unique identifier for each user
    const namespace = "default"; // Assuming a default namespace, adjust as needed

    try {
        const kubeManifests = readAndParseKubeYaml(path.join(__dirname, "../service.yaml"), CloudID);
        for (const manifest of kubeManifests) {
            switch (manifest.kind) {
                case "Deployment":
                    await appsV1Api.createNamespacedDeployment({ namespace, body: manifest });
                    break;
                case "Service":
                    await coreV1Api.createNamespacedService({ namespace, body: manifest });
                    break;
                case "Ingress":
                    await networkingV1Api.createNamespacedIngress({ namespace, body: manifest });
                    break;
                default:
                    console.log(`Unsupported kind: ${manifest.kind}`);
            }
        }
        res.status(200).send({ message: "Resources created successfully" });
    } catch (error) {
        console.error("Failed to create resources", error);
        res.status(500).send({ message: "Failed to create resources" });
    }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`Orchestration service running on port ${PORT}`);
});