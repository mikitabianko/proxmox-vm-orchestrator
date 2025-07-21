import { promises as fs, PathLike } from "fs";
import { createHash } from "crypto";
import { join, posix, relative } from "path";
import { File } from "./types";

/**
 * Computes a deterministic SHA-256 hash of an array of File objects.
 * Files are sorted by their full path (`parentPath/name`) to ensure consistent ordering.
 * The hash is updated with each file’s parent path, name, and data, separated by a newline.
 *
 * @param files - Array of File objects to hash.
 * @returns A Buffer containing the SHA-256 hash digest.
 */
export function computeMetaHash(files: File[]): Buffer {
    const hash = createHash('sha256');

    // Sort files by full path (parentPath/name) for deterministic order.
    [...files]
        .sort((a, b) => `${a.parentPath}/${a.name}`.localeCompare(`${b.parentPath}/${b.name}`))
        .forEach(file => {
            // Include the file path and name in the hash (UTF-8 encoding).
            hash.update(`${file.parentPath}:${file.name}:`, 'utf8');
            // Include the file content data in the hash.
            hash.update(normalizeBuffer(file.data));
            hash.update('\n');  // delimiter to separate files
        });

    return hash.digest();
}

/**
 * Recursively reads all files under the given directory.
 * Returns a promise that resolves to an array of File objects, each containing:
 * - `name`: the filename,
 * - `parentPath`: the directory path (relative to `dir`) containing the file,
 * - `path`: the full path (relative to `dir`) of the file,
 * - `data`: a Buffer of the file’s contents.
 *
 * @param dir - The base directory to scan for files.
 * @param baseDir - (Internal) The root directory for relative paths. Defaults to `dir`.
 * @returns A promise resolving to an array of File objects for all found files.
 */
export async function readFiles(dir: string, baseDir: string = dir): Promise<File[]> {
    const files: File[] = [];
    // Asynchronously open the directory for iterative scanning
    const dirHandle = await fs.opendir(dir);
    for await (const entry of dirHandle) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            // Recurse into subdirectories
            const subFiles = await readFiles(fullPath, baseDir);
            files.push(...subFiles);
        } else if (entry.isFile()) {
            // Compute relative parent path and full file path from the base directory
            const relativeParent = stripBasePath(dir, baseDir);
            const parentPath = "./" + relativeParent;
            const relativePath = stripBasePath(fullPath, baseDir);
            const fileData = await fs.readFile(fullPath);
            files.push({
                name: entry.name,
                parentPath: parentPath,
                path: "./" + relativePath,
                data: fileData
            });
        }
    }
    return files;
}

/**
 * Checks whether the given path exists and is a directory.
 * Returns `true` if it exists and is a directory, `false` if it does not exist.
 * Throws other errors (e.g., permission errors) to be handled by the caller.
 *
 * @param path - The filesystem path to check.
 * @returns A promise resolving to `true` if the directory exists, otherwise `false`.
 */
export async function checkFolderExists(path: string): Promise<boolean> {
    try {
        const stats = await fs.stat(path);
        return stats.isDirectory();
    } catch (err: any) {
        if (err.code === "ENOENT") {
            // Path does not exist
            return false;
        }
        // Other errors (e.g., permissions) bubble up
        throw err;
    }
}

/**
 * Writes an array of File objects into the specified working directory.
 * Creates any missing directories (using recursive mkdir) before writing.
 * Each file’s data is written to disk, and finally the function returns
 * the SHA-256 hash of all files (via `computeMetaHash`) for verification.
 *
 * @param workDir - The target directory where files will be written.
 * @param files - Array of File objects to write.
 * @returns A Buffer containing the hash digest of all written files.
 */
export async function writeFiles(workDir: string, files: File[]): Promise<Buffer> {
    // Ensure the main working directory exists (create recursively if needed)
    if (!(await checkFolderExists(workDir))) {
        await fs.mkdir(workDir, { recursive: true });
    }

    for (const file of files) {
        const targetDir = join(workDir, file.parentPath.toString());
        if (!(await checkFolderExists(targetDir))) {
            // Create parent directory structure if it doesn't exist
            await fs.mkdir(targetDir, { recursive: true });
        }
        // Write file content (normalizeBuffer ensures we have a Buffer) 
        await fs.writeFile(join(targetDir, file.name), normalizeBuffer(file.data), file.options || {});
    }

    // Return the combined hash of all files for integrity check
    return computeMetaHash(files);
}

/**
 * Ensures the input data is a Buffer. Accepts:
 * - Buffer: returned as-is.
 * - Array (of bytes): converted to Buffer via Buffer.from(array).
 * - Object: converted by taking Object.values() and then Buffer.from().
 * Throws an error for unsupported types.
 *
 * @param data - The data to normalize.
 * @returns A Buffer containing the input data.
 */
export function normalizeBuffer(data: any): Buffer {
    if (Buffer.isBuffer(data)) {
        return data;
    }
    if (Array.isArray(data)) {
        // Interpret array as byte values
        return Buffer.from(data);
    }
    if (typeof data === 'object' && data !== null) {
        // Convert object values to a Buffer (non-null object)
        return Buffer.from(Object.values(data) as any);
    }
    throw new Error('Unsupported data format for buffer');
}
/**
 * Removes the base directory prefix from a full path, returning a relative POSIX-style path.
 * Ensures consistency in slashes and removes any leading slashes.
 * Throws an error if `fullPath` is not under the given `basePath`.
 *
 * @param fullPath - The full filesystem path (string or PathLike).
 * @param basePath - The base path to strip (string or PathLike).
 * @returns A string representing the relative path from basePath to fullPath (without leading `/`).
 */
export function stripBasePath(fullPath: string | PathLike, basePath: string | PathLike): string {
    const fullStr = fullPath.toString();
    const baseStr = basePath.toString();
    // Use path.relative for a cleaner approach, then convert to POSIX separators.
    const relativePath = relative(baseStr, fullStr);
    if (relativePath.startsWith('..')) {
        throw new Error(`Path "${fullPath}" is not under base path "${basePath}"`);
    }
    // Normalize to POSIX (forward slashes) and remove any leading './'
    return posix.normalize(relativePath).replace(/^\.\/+/g, '');
}

/**
 * Dynamically imports an ES module from `pathToInventory`, calls its default-exported function
 * with the provided `ctx` argument, and returns a File object containing the resulting JSON.
 * The returned File represents "inventory.json" with the module’s output serialized to JSON.
 *
 * @param pathToInventory - Path to a JS module exporting a default function (as ESM).
 * @param ctx - An object to pass to the default function.
 * @returns A promise resolving to a File object for "inventory.json".
 * @throws If the path is invalid, module import fails, no default function exists, or JSON stringify fails.
 */
export async function createAnsibleInventory(pathToInventory: string, ctx: any): Promise<File> {
    if (typeof pathToInventory !== 'string' || pathToInventory.trim() === '') {
        throw new Error('Invalid pathToInventory: must be a non-empty string');
    }
    // Dynamically import the module (returns a namespace with exports)
    let inventoryModule: any;
    try {
        inventoryModule = await import(pathToInventory);
    } catch (err: any) {
        throw new Error(`Failed to import module from path "${pathToInventory}": ${err.message}`);
    }
    // The module must have a default-exported function
    if (!inventoryModule || typeof inventoryModule.default !== 'function') {
        throw new Error('Imported module does not have a default export function');
    }
    if (typeof ctx !== 'object' || ctx === null) {
        throw new Error('Invalid context object (ctx): must be a non-null object');
    }

    // Call the default function to get the inventory object
    let inventoryObj: any;
    try {
        inventoryObj = inventoryModule.default(ctx);
    } catch (err: any) {
        throw new Error(`Error running inventory function: ${err.message}`);
    }
    if (typeof inventoryObj !== 'object' || inventoryObj === null) {
        throw new Error('The default export function did not return a valid object');
    }

    // Convert the inventory object to a pretty-printed JSON string
    let inventoryJson: string;
    try {
        inventoryJson = JSON.stringify(inventoryObj, null, 2);
    } catch (err: any) {
        throw new Error(`Failed to stringify inventory object: ${err.message}`);
    }

    // Return as a File object named "inventory.json"
    return {
        parentPath: "./",
        path: "./inventory.json",
        name: "inventory.json",
        data: Buffer.from(inventoryJson, 'utf-8'),
    };
}