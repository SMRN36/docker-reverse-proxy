const http = require("http");
const express = require("express");
const Docker = require("dockerode");
const httpProxy = require("http-proxy");

const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const proxy = httpProxy.createProxy({});

const db = new Map();

docker.getEvents(function (err, stream) {
    if(err){
        console.log('Error in getting events', err);
        return;
    }

    stream.on("data", async (chunk) => {
    try{
        if(!chunk) return;
        const event = JSON.parse(chunk.toString());

        if(event.Type === 'container' && event.Action == 'start'){
            const container = docker.getContainer(event.id);
            const containerInfo = await container.inspect();

            const containerName = containerInfo.Name.substring(1);
            const ipAddress = containerInfo.NetworkSettings.IPAddress;

            const exposedPort = Object.keys(containerInfo.Config.ExposedPorts);
            let defaultPort = null;

            if(exposedPort && exposedPort.length > 0){
                const [port, type] = exposedPort[0].split("/");
                if(type === "tcp"){
                    defaultPort = port;
                }
            }
            console.log(
                `Registering ${containerName}.localhost --> http://${ipAddress}:${defaultPort}`
            );
            db.set(containerName, { containerName, ipAddress, defaultPort });
        }
    } catch (err) {}
        
    });
});

// creating reverse proxy
const reverseProxyApp = express();

reverseProxyApp.use(function(req, res){
    const hostname = req.hostname;
    const subdomain = hostname.split('.')[0];
    
    if(!db.has(subdomain)) return res.status(404).end(404);

    const { ipAddress, defaultPort } = db.get(subdomain);

    const target = `http://${ipAddress}:${defaultPort}`;

    console.log(`Forwarding ${hostname} --> ${target}`);

    return proxy.web(req, res, { target, changeOrigin  :true, ws: true });
});

const reverseProxy = http.createServer(reverseProxyApp);

reverseProxy.on('upgrade', (req, socket, head) => {
    const hostname = req.hostname;
    const subdomain = hostname.split('.')[0];
    
    if(!db.has(subdomain)) return res.status(404).end(404);

    const { ipAddress, defaultPort } = db.get(subdomain);

    const target = `http://${ipAddress}:${defaultPort}`;

    console.log(`Forwarding ${hostname} --> ${target}`);

    return proxy.ws(req, socket, head, {
        target: proxyRequest,
        ws: true,
    });
})

const managementAPI = express();

managementAPI.use(express.json());

// Start a container
managementAPI.post("/containers", async (req, res) => {
    const {image, tag = "latest"} = req.body;

    let imageAlreadyExists = false;
    const images = await docker.listImages();
    for(const systemImage of images){
        for(const systemTag of systemImage.RepoTags){
            if(systemTag === `${image}:${tag}`){
                imageAlreadyExists = true;
                break;
            }
        }
        if(imageAlreadyExists) break;
    }
    if(!imageAlreadyExists){
        console.log(`Pulling Image: ${image}:${tag}`);
        await docker.pull(`${image}:${tag}`);
    }

    const container = await docker.createContainer({
        Image: `${image}:${tag}`,
        Tty: false,
        HostConfig: {
            AutoRemove: true,
        },
    });

    await container.start();

    return res.json({
        status: "success",
        container: `${(await container.inspect()).Name}.localhost`,
    });
});

// Stop a container
managementAPI.post("/containers/:id/stop", async (req, res) => {
    const { id } = req.params;

    try {
        const container = docker.getContainer(id);
        await container.stop();
        res.json({ status: "success", message: `Container ${id} stopped.` });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

// Remove a container
managementAPI.delete("/containers/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const container = docker.getContainer(id);
        await container.remove();
        res.json({ status: "success", message: `Container ${id} removed.` });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

// List all containers
managementAPI.get("/containers", async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        res.json({ status: "success", containers });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

// Inspect a specific container
managementAPI.get("/containers/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const container = docker.getContainer(id);
        const data = await container.inspect();
        res.json({ status: "success", data });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

managementAPI.listen(8080, () => 
    console.log('Management API is running on PORT 8080')
);

reverseProxy.listen(80, () =>{
    console.log('Reverse Proxy is running on PORT 80');
});