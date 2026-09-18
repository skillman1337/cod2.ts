/*
===============================================================================

	vite-env.d.ts

	Call of Duty 2 / id Tech WebGPU Browser Engine Vite Environment Types
	Provides minimal Vite-facing declarations used by source code and native builds.

===============================================================================
*/

interface ImportMetaHot {
	dispose( callback: () => void ): void;
	accept( callback?: () => void ): void;
}

interface ImportMeta {
	readonly hot?: ImportMetaHot;
}

declare const __BUILD_REVISION__: string | null;
declare const __BUILD_COMPILER_VERSION__: number;
declare const __BUILD_CACHE_VERSION__: number;


declare module '*?url' {
	const url: string;
	export default url;
}
