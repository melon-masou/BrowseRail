export function instanceLabelFromUid(uid: string): string {
  return `Browser-${uid.replaceAll("-", "").slice(0, 8)}`;
}

export function createRandomInstanceLabel(): string {
  return instanceLabelFromUid(crypto.randomUUID());
}
