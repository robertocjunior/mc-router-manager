
# MC Router Manager 🎮

**MC Router Manager** is a simple yet powerful web interface to manage Minecraft server routing. Built on top of the amazing [mc-router](https://github.com/itzg/mc-router) by **itzg**, this project provides a visual dashboard (inspired by Nginx Proxy Manager) to configure connection forwarding without manually editing JSON files.

The system runs in a **single container**, combining the routing process and the management dashboard.

## ✨ Features

* **Intuitive Web UI:** Manage your routes through a clean, responsive dashboard (powered by [Tabler](https://tabler.io/)).
* **Single Container:** The web panel and the router binary run together. No complex microservices setup.
* **Secure Authentication:** Built-in login system with an initial Master Account setup.
* **Domain Mapping:** Forward connections based on the domain name the player types (e.g., `survival.myserver.com` -> `192.168.1.50:25566`).
* **Default Route (Wildcard):** Support for `*` routes to forward unknown connections or direct IP hits to a main lobby.
* **Data Persistence:** Users and configurations are saved in an internal SQLite database.
* **Auto-Reload:** The routing service automatically restarts whenever you save changes in the dashboard.

## 🚀 Quick Start (Docker Compose)

The easiest way to run this project is using Docker Compose.

1. Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  mc-manager:
    container_name: mc-manager
    # Option A: Build locally
    build: .
    # Option B: Use image (if you push it to Docker Hub)
    # image: your-username/mc-router-manager:latest
    ports:
      - "3000:3000"   # Web Dashboard Port
      - "25565:25565" # Minecraft Ingress Port (Players connect here)
    volumes:
      - ./data:/app/data
    restart: unless-stopped

```

2. Start the container:

```bash
docker compose up -d --build

```

3. Access the dashboard in your browser:
* **URL:** `http://your-ip:3000`



## ⚙️ Initial Configuration

When you access the panel for the first time, you will be automatically redirected to the **Setup Screen**.
Create your Administrator account (Name, Email, and Password).

## 📖 How to Use

### Adding a Domain Route

If you want players to connect to a specific backend server when typing a domain:

1. Click **Add Route**.
2. **Entry Address:** Type the domain (e.g., `skywars.myserver.com`).
3. **Destination:** Type the IP and Port of the actual server (e.g., `172.18.0.5:25566`).
4. Click **Save**.

### Adding a Default Route (Wildcard)

If you want to define where players go if they type just the IP or an unknown domain:

1. Click **Add Route**.
2. **Entry Address:** Type just `*` (asterisk) or leave it empty.
3. **Destination:** Type the IP and Port of your main server (Lobby).
4. Click **Save**.

## 🛠️ Tech Stack

* **Backend:** Node.js, Express.
* **Frontend:** EJS, Tabler UI.
* **Database:** SQLite.
* **Core:** [mc-router](https://github.com/itzg/mc-router) (Go).

## 👏 Credits & Acknowledgments

This project wouldn't be possible without these amazing tools:

* **[itzg/mc-router](https://github.com/itzg/mc-router):** For the core binary that handles the actual Minecraft packet routing.
* **[Tabler](https://github.com/tabler/tabler):** For the modern, open-source UI framework.
* **Roberto C. Junior:** Developer of MC Router Manager.

## 📄 License

This project is licensed under the [**MIT License**](./LICENSE.txt).