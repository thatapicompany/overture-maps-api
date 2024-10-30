FROM node:17-stretch

WORKDIR /app

COPY package*.json ./

RUN npm install
RUN git --version

COPY src ./src
RUN ls ./

#ARG NODE_ENV=prod
#ENV NODE_ENV=${NODE_ENV}

#COPY tools ./tools

# placeholders for validation
RUN [ "touch",".env"]
RUN [ "touch",".env.staging"]
RUN [ "touch",".env.dev"]
RUN [ "touch",".env.production"]

COPY tsconfig.json .
COPY tsconfig.build.json .

RUN [ "npm", "run", "build"]


EXPOSE 8080

CMD [ "npm", "run", "start" ]
# COPY entrypoint.sh .
 # ENTRYPOINT [ "/app/entrypoint.sh" ]
