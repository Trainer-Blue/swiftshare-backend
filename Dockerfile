# STEP 1: Choose base image (like choosing an operating system)
# node:20-alpine = Lightweight Linux with Node.js 20 pre-installed
FROM node:20-alpine

# STEP 2: Set working directory inside container
# This is like creating a folder where your app will live
WORKDIR /app

# STEP 3: Copy package files first (for better caching)
# Docker caches layers - if package.json doesn't change, it won't reinstall packages
COPY package*.json ./

# STEP 4: Install dependencies
# This runs "npm install" inside the container
RUN npm install --production

# STEP 5: Copy the rest of your application code
# This copies server.js, persistence.js, utils.js, etc.
COPY . .

# STEP 6: Expose the port your app runs on
# This tells Docker "my app uses port 1234"
EXPOSE 1234

# STEP 7: Define the command to run your app
# When container starts, run this command
CMD ["node", "server.js"]
