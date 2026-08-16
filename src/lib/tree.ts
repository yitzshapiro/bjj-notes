export const GOOGLE_DRIVE_FOLDER_MIME_TYPE =
  "application/vnd.google-apps.folder";

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  parentId: string | null;
  modifiedTime?: string;
  thumbnailLink?: string;
}

export interface DriveTreeNode {
  id: string;
  name: string;
  mimeType: string;
  parentId: string | null;
  type: "folder" | "video";
  /** Exact Drive names from the configured root through this node. */
  path: string[];
  modifiedTime?: string;
  thumbnailLink?: string;
  children: DriveTreeNode[];
}

const nameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export function isDriveFolder(item: Pick<DriveItem, "mimeType">): boolean {
  return item.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE;
}

export function isDriveVideo(item: Pick<DriveItem, "mimeType">): boolean {
  return item.mimeType.startsWith("video/");
}

function compareItems(a: DriveItem, b: DriveItem): number {
  const typeOrder = Number(isDriveFolder(b)) - Number(isDriveFolder(a));
  if (typeOrder !== 0) return typeOrder;

  const naturalNameOrder = nameCollator.compare(a.name, b.name);
  if (naturalNameOrder !== 0) return naturalNameOrder;

  const exactNameOrder = a.name.localeCompare(b.name, "en");
  if (exactNameOrder !== 0) return exactNameOrder;

  return a.id.localeCompare(b.id, "en");
}

/**
 * Builds the visible library rooted at `rootFolderId`.
 *
 * The root item must be present in `items`. Folders and video files are retained;
 * unrelated Drive files and items outside the configured root are omitted. Names
 * are never normalized, so `path` mirrors the Drive hierarchy exactly.
 */
export function buildDriveTree(
  items: readonly DriveItem[],
  rootFolderId: string,
): DriveTreeNode {
  const byId = new Map<string, DriveItem>();

  for (const item of items) {
    if (byId.has(item.id)) {
      throw new Error(`Duplicate Drive item id: ${item.id}`);
    }
    byId.set(item.id, item);
  }

  const root = byId.get(rootFolderId);
  if (!root) {
    throw new Error(`Drive root folder not found: ${rootFolderId}`);
  }
  if (!isDriveFolder(root)) {
    throw new Error(`Drive root is not a folder: ${rootFolderId}`);
  }

  const childrenByParent = new Map<string, DriveItem[]>();
  for (const item of items) {
    if (!item.parentId) continue;
    if (!isDriveFolder(item) && !isDriveVideo(item)) continue;

    const siblings = childrenByParent.get(item.parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parentId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareItems);
  }

  const visiting = new Set<string>();

  const visit = (item: DriveItem, parentPath: readonly string[]): DriveTreeNode => {
    if (visiting.has(item.id)) {
      throw new Error(`Cycle detected in Drive hierarchy at: ${item.id}`);
    }

    visiting.add(item.id);
    const path = [...parentPath, item.name];
    const folder = isDriveFolder(item);
    const children = folder
      ? (childrenByParent.get(item.id) ?? []).map((child) => visit(child, path))
      : [];
    visiting.delete(item.id);

    return {
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      parentId: item.parentId,
      type: folder ? "folder" : "video",
      path,
      modifiedTime: item.modifiedTime,
      thumbnailLink: item.thumbnailLink,
      children,
    };
  };

  return visit(root, []);
}
