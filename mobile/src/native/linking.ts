import { Linking } from "react-native";

export function initialUrl(): Promise<string | null> {
  return Linking.getInitialURL().then((u) => u ?? null);
}

export function watchUrls(fn: (url: string) => void): () => void {
  const sub = Linking.addEventListener("url", (e) => fn(e.url));
  return () => sub.remove();
}
