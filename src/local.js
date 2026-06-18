import { createApp } from "./server.js";

const publicPort = Number(process.env.PUBLIC_PORT || 3000);
const adminPort = Number(process.env.ADMIN_PORT || 3001);

createApp({ mode: "public" }).listen(publicPort, () => {
  console.log(`Lucky wheel public server is running at http://127.0.0.1:${publicPort}`);
});

createApp({ mode: "admin" }).listen(adminPort, "127.0.0.1", () => {
  console.log(`Lucky wheel admin server is running at http://127.0.0.1:${adminPort}`);
});
