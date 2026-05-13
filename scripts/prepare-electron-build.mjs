import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const buildDir = path.join(rootDir, ".next-build");
const standaloneDir = path.join(buildDir, "standalone");
const standaloneNextDir = path.join(standaloneDir, ".next-build");
const staticSourceDir = path.join(buildDir, "static");
const staticTargetDir = path.join(standaloneNextDir, "static");
const unsafePaths = [
  path.join(standaloneDir, "storage"),
  path.join(standaloneDir, ".env"),
  path.join(standaloneDir, ".env.local")
];

if (!existsSync(standaloneDir)) {
  throw new Error("未找到 Next standalone 构建目录，请先运行 npm run build。");
}

unsafePaths.forEach((unsafePath) => {
  rmSync(unsafePath, {
    force: true,
    recursive: true
  });
});

if (existsSync(staticSourceDir)) {
  rmSync(staticTargetDir, {
    force: true,
    recursive: true
  });
  cpSync(staticSourceDir, staticTargetDir, {
    recursive: true
  });
}

console.log("Electron 打包准备完成：已清理本机 storage，并复制静态资源。");
