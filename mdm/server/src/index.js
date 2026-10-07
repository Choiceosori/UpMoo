import http from "node:http";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { Auth, randomSecret } from "./auth.js";
import { loadConfig } from "./config.js";
import { createHandler } from "./http.js";
import { Hub } from "./hub.js";
import { setLoginSites } from "./lesson.js";
import { Store } from "./store.js";

export function createServer(config = loadConfig()) {
  const store = new Store(config.dataDir).load();
  setLoginSites(config.loginSites);

  let secret = config.secret || store.meta("secret");
  if (!secret) secret = store.meta("secret", randomSecret());
  if (!config.adminPassword) {
    config.adminPassword = randomSecret(6);
    console.warn(`[woori] MDM_ADMIN_PASSWORD가 없어 임시 관리자 비밀번호를 만들었어요: ${config.adminPassword}`);
  }

  const auth = new Auth(secret);
  const hub = new Hub({ store, auth, config });
  const server = http.createServer(createHandler({ store, hub, auth, config }));
  hub.attach(server);

  return {
    server,
    store,
    hub,
    auth,
    config,
    async listen() {
      await new Promise((resolve) => server.listen(config.port, config.host, resolve));
      return server.address();
    },
    async close() {
      hub.close();
      await new Promise((resolve) => server.close(resolve));
      store.flush();
    },
  };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createServer();
  const { port } = await app.listen();
  console.log(`[woori] ${app.config.appName} 실행 중 — 포트 ${port}`);
  for (const ip of lanAddresses()) {
    console.log(`  선생님 화면: http://${ip}:${port}/teacher`);
    console.log(`  학생 입장:   http://${ip}:${port}/`);
  }
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
