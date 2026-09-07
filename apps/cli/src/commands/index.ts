import { assetUpload } from "./asset.js";
import {
  collectionCreate,
  collectionDelete,
  collectionList,
  collectionRename,
} from "./collection.js";
import type { CommandHandler } from "./context.js";
import {
  docArchive,
  docList,
  docMove,
  docPublish,
  docRename,
  docRestore,
  docShow,
  docUnarchive,
  docVersions,
} from "./doc.js";
import { feedbackShow, feedbackWait, feedbackWatch } from "./feedback.js";
import { serverStart, serverStatus, serverStop } from "./server.js";
import { skillInstall } from "./skill.js";

export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  "server start": serverStart,
  "server stop": serverStop,
  "server status": serverStatus,
  "asset upload": assetUpload,
  "collection list": collectionList,
  "collection create": collectionCreate,
  "collection rename": collectionRename,
  "collection delete": collectionDelete,
  "doc list": docList,
  "doc show": docShow,
  "doc publish": docPublish,
  "doc rename": docRename,
  "doc move": docMove,
  "doc archive": docArchive,
  "doc unarchive": docUnarchive,
  "doc versions": docVersions,
  "doc restore": docRestore,
  "feedback show": feedbackShow,
  "feedback wait": feedbackWait,
  "feedback watch": feedbackWatch,
  "skill install": skillInstall,
};
