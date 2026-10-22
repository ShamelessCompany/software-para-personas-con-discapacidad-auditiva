export function validatePeX64(buffer: Buffer): string | null;
export function parseSelfTestOutput(stdout: string): Record<string, unknown> | null;
export function validateManifest(manifest: unknown, fileSize: number, fileSha256: string): boolean;
