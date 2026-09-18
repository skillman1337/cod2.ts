/*
===============================================================================

	rgpu_draw_contract.ts

	Call of Duty 2 / id Tech WebGPU Hardware Draw Resource Contracts
	Capability interfaces providing low-level hardware buffer, texture,
	pipeline, and upload facilities to individual render sub-systems.

===============================================================================
*/


// ---------------------------------------------------------------------------
// types & hardware capability interfaces
// ---------------------------------------------------------------------------

/*
====================
rgpu_draw_resources_t

Hardware creation interface exposing GPU device allocators to renderers.
====================
*/
export interface rgpu_draw_resources_t {
	readonly format: GPUTextureFormat;
	readonly limits?: GPUSupportedLimits;
	createTexture?( descriptor: GPUTextureDescriptor ): GPUTexture;
	createSampler?( descriptor: GPUSamplerDescriptor ): GPUSampler;
	createShaderModule( descriptor: GPUShaderModuleDescriptor ): GPUShaderModule;
	createBindGroupLayout( descriptor: GPUBindGroupLayoutDescriptor ): GPUBindGroupLayout;
	createPipelineLayout( descriptor: GPUPipelineLayoutDescriptor ): GPUPipelineLayout;
	createRenderPipeline( descriptor: GPURenderPipelineDescriptor ): GPURenderPipeline;
	createBuffer( descriptor: GPUBufferDescriptor ): GPUBuffer;
	createBindGroup( descriptor: GPUBindGroupDescriptor ): GPUBindGroup;
}

/*
====================
rgpu_draw_upload_t

Queue upload interface for staging CPU geometry, textures, and uniform buffers.
====================
*/
export interface rgpu_draw_upload_t {
	writeTexture?(
		destination: GPUImageCopyTexture,
		data: GPUAllowSharedBufferSource,
		layout: GPUImageDataLayout,
		size: GPUExtent3D
	): void;
	copyExternalImageToTexture?(
		source: GPUCopyExternalImageSourceInfo,
		destination: GPUCopyExternalImageDestInfo,
		size: GPUExtent3D
	): void;
	writeBuffer(
		buffer: GPUBuffer,
		offset: number,
		data: ArrayBuffer,
		dataOffset: number,
		size: number
	): void;
}
