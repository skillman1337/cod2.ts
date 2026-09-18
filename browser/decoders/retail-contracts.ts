/*
===============================================================================

	retail-contracts.ts

	Asset compiler value contracts. No browser or engine lifecycle state.

===============================================================================
*/

export interface FileRecord {
	path: string;
	size: number;
}

export interface SoundAliasRow {
	rawAlias: string;
	alias: string;
	file: string;
	soundPath: string;
	probability: number;
	volumeMin: number;
	volumeMax: number;
	pitchMin: number;
	pitchMax: number;
	loop: boolean;
	channel: string;
	loadspec: string;
}

export type TaskCallback = ( info: { path: string; files?: number; bytes?: number } ) => void;
export type ProgressCallback = ( message: string ) => void;
export type LogCallback = ( message: string ) => void;
export type WriteFileCallback = ( path: string, bytes: Uint8Array ) => Promise<void>;


