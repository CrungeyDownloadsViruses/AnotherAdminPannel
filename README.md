# Benfits over other options

- easy to install

- discord login

- no need for docker or sql

# Features:

- instance management

- file editor

- discord authentication

- plugin support for custom pannel features (example is included and installed with this software)

- fast and lightweight

- open source

- easy to access node manager for scalability

# Upcoming:

- upnp forwarding support for homelab setups

- mod browser for fabric/forge/neoforge servers

- download and upload server instances as zip files

- move instances between servers

# Preview:

main features:

<img width="2532" height="1219" alt="image" src="https://github.com/user-attachments/assets/0a96c144-1523-4765-b1ce-971739ff7298" />


multi-instance support:

<img width="2537" height="721" alt="image" src="https://github.com/user-attachments/assets/e15e46b0-debf-4c5d-960f-2359eb600de1" />


plugin downloader via modrinth api:

<img width="2528" height="1263" alt="image" src="https://github.com/user-attachments/assets/577de3bd-d3f9-408c-aa98-cf3a90f2546a" />

Easy scaling across potentially infinite servers:

<img width="2541" height="1263" alt="image" src="https://github.com/user-attachments/assets/2bbe3ee0-e845-4750-8fa8-78cfd95349f3" />

and plugin support (loads anything in the plugins directory) (included with the source code)



# Installation steps:
---
### Install NodeJS v20.11.1
[download](https://nodejs.org/en/download/archive/v20.11.1)

---
### Download the source code
---
### Set up a Discord Application for authorization
[setup link](https://discord.com/developers/applications)
<img width="1799" height="280" alt="image" src="https://github.com/user-attachments/assets/834e7d56-742b-4160-ab55-6b1be372fdf5" />
<img width="597" height="356" alt="image" src="https://github.com/user-attachments/assets/430e1869-5599-4594-8585-eea6528bc6f9" />
<img width="1210" height="643" alt="image" src="https://github.com/user-attachments/assets/80cc50bc-84b2-4e59-b65c-7fa80806cdc6" />
<img width="1201" height="219" alt="image" src="https://github.com/user-attachments/assets/29a6fa8b-bd41-4641-b52c-b7d6cc3030af" />

you will need to reset the secret to make it visible.
paste them in loginCfg.json:

<img width="579" height="110" alt="image" src="https://github.com/user-attachments/assets/5ca384f5-be2e-4851-a07f-6d86ecd9b201" />

add the website you are hosting the pannel on to the application:

<img width="1692" height="165" alt="image" src="https://github.com/user-attachments/assets/74e721fe-da90-4923-bee2-7e0fd14250ae" />

---
### Add the discord account IDs of those who can access the pannel to allowedids.txt

<img width="453" height="460" alt="image" src="https://github.com/user-attachments/assets/8fbe4620-0199-43d5-bb89-7dcce1167bc7" />

<img width="336" height="97" alt="image" src="https://github.com/user-attachments/assets/fcfc4dfb-71e2-4396-8d8d-1027b09a725c" />

---
### Install other componets

navigate to the project's folder in a terminal and run ```npm install```

### Run the program

if on linux, do ```chmod +x run.sh``` then ```./run.sh```

if on windows, launch run.bat

# server node setup

---
### Install NodeJS v20.11.1
[download](https://nodejs.org/en/download/archive/v20.11.1)

---
### Download the source code
---

---
### Navigate to the base folder and run ```npm install```
---

---
### Navigate to the ```server node``` folder
---

### Run the program

if on linux, do ```chmod +x run.sh``` then ```./run.sh```

if on windows, launch run.bat

---

### Open the included cfg.json

then copy the keyphrase somewhere secure where you will remember it

---

### Open the main panel in a browser

navigate to the node manager

on the left, type in the node's public ip address followed by a colon then the port (defaut is 3031)
ex: 64.233.160.0:3031

then paste the keyphrase as the secret

finally, name the node anything and click "add node"
