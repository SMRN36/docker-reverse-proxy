const http = require("http");
const express = require("express");
const Docker = require("dockerode");

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

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