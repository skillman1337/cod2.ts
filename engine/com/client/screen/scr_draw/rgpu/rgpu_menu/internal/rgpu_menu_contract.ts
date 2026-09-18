/*
===============================================================================

	rgpu_menu_contract.ts

	Private capability contracts shared by the rgpu_menu implementation files.
	No raw GPUDevice, GPUQueue, GPUCanvasContext, command encoder, or submit
	capability crosses this boundary.

===============================================================================
*/


/** Resource construction capability issued for one immutable device epoch. */
export interface rgpu_menu_resources_t {
	readonly format: GPUTextureFormat;
	createSampler( descriptor?: GPUSamplerDescriptor ): GPUSampler;
	createBuffer( descriptor: GPUBufferDescriptor ): GPUBuffer;
	createShaderModule( descriptor: GPUShaderModuleDescriptor ): GPUShaderModule;
	createBindGroupLayout( descriptor: GPUBindGroupLayoutDescriptor ): GPUBindGroupLayout;
	createPipelineLayout( descriptor: GPUPipelineLayoutDescriptor ): GPUPipelineLayout;
	createRenderPipeline( descriptor: GPURenderPipelineDescriptor ): GPURenderPipeline;
	createBindGroup( descriptor: GPUBindGroupDescriptor ): GPUBindGroup;
	createTexture( descriptor: GPUTextureDescriptor ): GPUTexture;
}


/** Upload-only queue capability. Deliberately excludes submit(). */
export interface rgpu_menu_upload_t {
	writeBuffer(
		buffer: GPUBuffer,
		buffer_offset: number,
		data: ArrayBuffer,
		data_offset: number,
		size: number,
	): void;
	writeTexture(
		destination: GPUTexelCopyTextureInfo,
		data: ArrayBuffer,
		data_layout: GPUTexelCopyBufferLayout,
		size: GPUExtent3DStrict,
	): void;
	copyExternalImageToTexture(
		source: GPUCopyExternalImageSourceInfo,
		destination: GPUCopyExternalImageDestInfo,
		size: GPUExtent3DStrict,
	): void;
}


/**
 * A child-visible view of one device generation. Every async operation captures
 * this object and checks isCurrent() after each await before touching GPU state.
 */
export interface rgpu_menu_epoch_t {
	readonly id: number;
	readonly format: GPUTextureFormat;
	readonly supports_bc: boolean;
	readonly signal: AbortSignal;
	readonly resources: rgpu_menu_resources_t;
	readonly upload: rgpu_menu_upload_t;
	isCurrent(): boolean;
	validate( label: string, operation: () => undefined ): Promise<string | null>;
}
