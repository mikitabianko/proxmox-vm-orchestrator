import { PathLike, WriteFileOptions } from "fs";

/**
 * Represents a file to be written to disk, including content and metadata.
 */
export interface File {
    /** File name (e.g., "main.tf") */
    name: string;
    /** Relative parent directory path (e.g., "./config") */
    parentPath: PathLike;
    /** Full or relative file path (e.g., "./config/main.tf") */
    path: PathLike;
    /** File content as a Buffer */
    data: Buffer;
    /** Optional write options (e.g., encoding, mode, flags) */
    options?: WriteFileOptions;
}

/**
 * Represents a remote host for Ansible provisioning.
 */
export interface Host {
    /** A friendly name or label for the host (e.g., "webserver1") */
    name: string;
    /** IP address or hostname of the remote machine */
    ip: string;
    /** SSH username used for connection */
    username: string;
    /** Password for authentication (consider encrypting or securing this) */
    password: string;
}

/**
 * Docker configuration for provisioning or image pulling.
 */
export interface Docker {
    /** List of Docker image names (e.g., "nginx:latest") */
    images: string[];
    /** Optional Docker registry URL (e.g., "https://index.docker.io/v1/") */
    registryUrl?: string;
    /** Optional username for registry authentication */
    username?: string;
    /** Optional password/token for registry authentication */
    password?: string;
}