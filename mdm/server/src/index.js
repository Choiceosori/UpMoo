import http from "node:http";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { Auth, randomSecret } from "./auth.js";
import { loadConfig } from "./config.js";
import { createHandler } from "./http.js";
import { Hub } from "./hub.js";
import { Scheduler } from "./scheduler.js";
import { Store } from "./store.js";

export function createServer(config = loadConfig()) {
  const store = new Store(config.dataFile).load();

  let secret = config.secret || store.getMeta("secret");
  if (!secret) {
    secret = randomSecret();
    store.setMeta("secret", secret);
  }
  if (!config.teacherPassword) {
    config.teacherPassword = randomSecret(6);
    console.warn(`[mdm] MDM_TEACHER_PASSWORD가 설정되지 않아 임시 비밀번호를 생성했습니다: ${config.teacherPassword}`);
  }

  const auth = new Auth(secret);
  const hub = new Hub({ store, auth, config });
  const scheduler = new Scheduler({
    store,
    hub,
    timezone: config.timezone,
    intervalMs: config.schedulerIntervalMs,
  });
  hub.onScheduleChanged = () => scheduler.tick();

  const server = http.createServer(createHandler({ store, hub, auth, config }));
  hub.attach(server);

  return {
    server,
    store,
    hub,
    auth,
    scheduler,
    config,
    async listen() {
      await new Promise((resolve) => server.listen(config.port, config.host, resolve));
      scheduler.start();
      return server.address();
    },
    async close() {
      scheduler.stop();
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createServer();
  const { port } = await app.listen();
  console.log(`[mdm] 서버 실행 중 — 포트 ${port}`);
  for (const ip of lanAddresses()) {
    console.log(`  교사 콘솔:   http://${ip}:${port}/`);
    console.log(`  학생 에이전트 서버 주소: ws://${ip}:${port}/ws`);
  }
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
