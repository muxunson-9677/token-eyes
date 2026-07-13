import { copy } from "./copy";

export function applyDocumentIdentity(target = document) {
  target.title = copy("shared.app_name");
}
