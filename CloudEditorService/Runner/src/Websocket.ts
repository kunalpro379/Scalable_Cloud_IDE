import { Server, Socket } from "socket.io";
import {Server as HttpServer} from "http";
import { saveToS3 } from "./AWS";
import path from "path";
import { fetchDir, fetchFileContent, saveFile } from "./filestream";
import { TerminalManager } from "./PTY";
import { exec } from "child_process";
import util from "util";


const execAsync = util.promisify(exec);

//tracl active terminal sessions
// const terminalManager = new TerminalManager();
const terminalSessions = new Map<string, any>();


export function initWs(httpServer: HttpServer) {
    const io = new Server(httpServer, {
        cors: {
            // Should restrict this more!
            origin: "*",
            methods: ["GET", "POST"],
        },
    });
      
    io.on("connection", async (socket) => {
        // const host = socket.handshake.headers.host;
        const cloudId = socket.handshake.query.cloudId as string;

        // console.log(`host is ${host}`);
        // const CloudID = host?.split('.')[0];
    
        if (!cloudId) {
            socket.disconnect();
            //terminalManager.clear(socket.id);
            return;
        }
        console.log(`Socket connected with cloudId: ${cloudId}`);
        socket.on("terminal", async(data:{command: string})=>{
            try{
                const { command } = data;
                const namespace=process.env.NAMESPACE||"cloud-editor";
                //get pod name for this cloud ID
                const {stdout:podName}=await execAsync(
                    // `kubectl get pods -n ${namespace} -l cloudId=${cloudId} -o jsonpath='{.items[0].metadata.name}'`
                    `kubectl -n ${namespace} get pods -l app=${cloudId} -o jsonpath="{.items[0].metadata.name}"`
                );
                if(!podName){
                    socket.emit("terminal", {data: "No pod found for this cloudId"});
                    return;
                }//exec command in the pod
                const {stdout, stderr}=await execAsync(
                    // `kubectl exec -n ${namespace} ${podName} -- /bin/sh -c "${command}"`
                    `kubectl -n ${namespace} exec ${podName.trim()} -- sh -c "cd /workspace && ${command}"`

                );
                socket.emit("terminal-response", {
                    output: stdout,
                    error: stderr
                });
            }catch(e){
                console.error("Terminal command error:", error);
                socket.emit("terminal-response", {
                    error: error.message || "Failed to execute command"
                });
            }
        });
        socket.on("file-read", async (data: {path: string}) => {
            try{
                const {path}=data;
                const namespace=process.env.NAMESPACE||"cloud-editor";
                //get pod name for this cloud Id
                const{stdout:podName}=await execAsync(
                    `kubectl -n ${namespace} get pods -l app=${cloudId} -o jsonpath="{.items[0].metadata.name}"`
                );
                if (!podName) {
                    socket.emit("file-content", {
                        error: "Container not found"
                    });
                    return;
                }

                //read file fromt the pod
                const {stdout}=await execAsync(
                    `kubectl -n ${namespace} exec ${podName.trim()} -- sh -c "cat /workspace/${path}"`

                );
                socket.emit("file-content", {
                    content: stdout
                });
                }catch(error){
                    console.error("File read error:", error);
                    socket.emit("file-content", {
                        error: error.message || "Failed to read file"
                    });
                }
        })
        socket.on("file-write", async (data: {path: string, content: string}) => {
            try{}catch(e){}
        })
        socket.on("file-save", async (data: {path: string, content: string}) => {   
            try {
                const { path, content } = data;
                const namespace = process.env.KUBE_NAMESPACE || "cloud-editor";
                
                // Get pod name for this cloud ID
                const { stdout: podName } = await execAsync(
                    `kubectl -n ${namespace} get pods -l app=${cloudId} -o jsonpath="{.items[0].metadata.name}"`
                );
                
                if (!podName) {
                    socket.emit("file-saved", {
                        error: "Container not found"
                    });
                    return;
                }

                // Save file in container
                await execAsync(
                    `kubectl -n ${namespace} exec ${podName.trim()} -- sh -c "mkdir -p /workspace/$(dirname '${path}') && cat > /workspace/${path} << 'EOF'\n${content}\nEOF"`
                );
                
                // Also save to S3 for persistence
                await saveToS3(`code/${cloudId}`, `/${path}`, content);
                
                socket.emit("file-saved", {
                    success: true,
                    path
                });
            }catch(error){
                console.error("File save error:", error);
                socket.emit("file-saved", {
                    error: error.message || "Failed to save file"
                });
            }
        });
        socket.on("list-dir", async (data: {path: string}) => {
            try {
                const { path } = data;
                const namespace = process.env.KUBE_NAMESPACE || "cloud-editor";
                
                // Get pod name for this cloud ID
                const { stdout: podName } = await execAsync(
                    `kubectl -n ${namespace} get pods -l app=${cloudId} -o jsonpath="{.items[0].metadata.name}"`
                );
                
                if (!podName) {
                    socket.emit("dir-content", {
                        error: "Container not found"
                    });
                    return;
                }
                                // List directory in container
                const { stdout } = await execAsync(
                    `kubectl -n ${namespace} exec ${podName.trim()} -- sh -c "ls -la /workspace/${path}"`
                );
                
                socket.emit("dir-content", {
                    content: stdout
                });
            } catch (error) {
                console.error("Directory list error:", error);
                socket.emit("dir-content", {
                    error: error.message || "Failed to list directory"
                });
            }
        });

        socket.on("run-project", async (data: {path: string}) => {
            try{
                const { language } = data;
                const namespace = process.env.KUBE_NAMESPACE || "cloud-editor";
                
                // Get pod name for this cloud ID
                const { stdout: podName } = await execAsync(
                    `kubectl -n ${namespace} get pods -l app=${cloudId} -o jsonpath="{.items[0].metadata.name}"`
                );
                
                if (!podName) {
                    socket.emit("run-output", {
                        error: "Container not found"
                    });
                    return;
                }
                // Get run command for this language
                let runCommand = "";
                switch (language) {
                    case "nodejs":
                        runCommand = "node index.js";
                        break;
                    case "python":
                        runCommand = "python main.py";
                        break;
                    case "java":
                        runCommand = "java Main";
                        break;
                    case "cpp":
                        runCommand = "g++ -o main main.cpp && ./main";
                        break;
                        case "go":
                            runCommand = "go run .";
                            break;
                        default:
                            socket.emit("run-output", {
                                error: `Unsupported language: ${language}`
                            });
                            return;
                    }
                    
                    // Execute run command
                    const { stdout, stderr } = await execAsync(
                        `kubectl -n ${namespace} exec ${podName.trim()} -- sh -c "cd /workspace && ${runCommand}"`
                    );
                    
                    socket.emit("run-output", {
                        output: stdout,
                        error: stderr
                    });
                } catch (error) {
                    console.error("Project run error:", error);
                    socket.emit("run-output", {
                        error: error.message || "Failed to run project"
                    });
                }
                });

                socket.emit("loaded", {
                    rootContent: await fetchDir("/workspace", "")
                });
                        // Handle disconnect
                socket.on("disconnect", () => {
                    console.log(`Socket disconnected: ${cloudId}`);
                });

        initHandlers(socket, CloudID);
    });
}

function initHandlers(socket: Socket, CloudID: string) {

    socket.on("disconnect", () => {
        console.log("user disconnected");
    });

    socket.on("fetchDir", async (dir: string, callback) => {
        const dirPath = `/workspace/${dir}`;
        const contents = await fetchDir(dirPath, dir);
        callback(contents);
    });

    socket.on("fetchContent", async ({ path: filePath }: { path: string }, callback) => {
        const fullPath = `/workspace/${filePath}`;
        const data = await fetchFileContent(fullPath);
        callback(data);
    });

    // TODO: contents should be diff, not full file
    // Should be validated for size
    // Should be throttled before updating S3 (or use an S3 mount)
    socket.on("updateContent", async ({ path: filePath, content }: { path: string, content: string }) => {
        const fullPath =  `/workspace/${filePath}`;
        await saveFile(fullPath, content);
        await saveToS3(`code/${CloudID}`, filePath, content);
    });

    socket.on("requestTerminal", async () => {
        terminalManager.createPty(socket.id, CloudID, (data, id) => {
            socket.emit('terminal', {
                data: Buffer.from(data,"utf-8")
            });
        });
    });
    
    socket.on("terminalData", async ({ data }: { data: string, terminalId: number }) => {
        terminalManager.write(socket.id, data);
    });

}