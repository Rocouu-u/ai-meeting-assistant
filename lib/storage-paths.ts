import path from "node:path";

export function getWritableDataDir() {
  return process.env.MEETING_ASSISTANT_USER_DATA || path.join(process.cwd(), "storage");
}

export function getWritableDataPath(fileName: string) {
  return path.join(getWritableDataDir(), fileName);
}

export function getBundledResourcePath(...segments: string[]) {
  const resourceRoot = process.env.MEETING_ASSISTANT_RESOURCES_DIR || process.cwd();

  return path.join(resourceRoot, ...segments);
}
