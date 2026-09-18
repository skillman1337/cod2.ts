/*
===============================================================================

	collision_broadphase.ts

	Call of Duty 2 / id Tech Static Collision Broadphase
	Conservative bounding-volume hierarchy (BVH) for static level geometry brushes.
	Accelerates swept capsule and ray queries while preserving original index order.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const COLLISION_LEAF_MAX_INDICES = 8;


// ---------------------------------------------------------------------------
// types & cache
// ---------------------------------------------------------------------------

export interface collision_bounds_t {
	bounds: readonly number[];
}

interface collision_node_t {
	bounds: number[];
	left: collision_node_t | null;
	right: collision_node_t | null;
	indices: number[] | null;
}

interface collision_tree_t {
	length: number;
	root: collision_node_t | null;
	stack: collision_node_t[];
}

const collisionTrees = new WeakMap<readonly collision_bounds_t[], collision_tree_t>();


// ---------------------------------------------------------------------------
// bvh construction
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Collision_Build
 *
 * Recursively partitions brush indices along the longest bounding box axis into an AABB tree.
 * Leaf nodes terminate with up to 8 brush indices.
 * ================
 */
function Collision_Build(
	items: readonly collision_bounds_t[],
	indices: number[]
): collision_node_t {
	const bounds = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];

	for ( const index of indices ) {
		const b = items[index].bounds;

		for ( let axis = 0; axis < 6; axis += 2 ) {
			bounds[axis] = Math.min( bounds[axis], b[axis] );
			bounds[axis + 1] = Math.max( bounds[axis + 1], b[axis + 1] );
		}
	}

	if ( indices.length <= COLLISION_LEAF_MAX_INDICES ) {
		return {
			bounds,
			left: null,
			right: null,
			indices,
		};
	}

	let axis = 0;

	if ( bounds[3] - bounds[2] > bounds[1] - bounds[0] ) {
		axis = 2;
	}

	if ( bounds[5] - bounds[4] > bounds[axis + 1] - bounds[axis] ) {
		axis = 4;
	}

	indices.sort(
		( a, b ) =>
			( items[a].bounds[axis] + items[a].bounds[axis + 1] ) -
			( items[b].bounds[axis] + items[b].bounds[axis + 1] ) ||
			a - b
	);

	const middle = indices.length >>> 1;

	return {
		bounds,
		indices: null,
		left: Collision_Build( items, indices.slice( 0, middle ) ),
		right: Collision_Build( items, indices.slice( middle ) ),
	};
}

/**
 * @exec helper
 * ================
 * Collision_Prepare
 *
 * Builds the BVH hierarchy once for a static array of collision bounds.
 * ================
 */
export function Collision_Prepare( items: readonly collision_bounds_t[] ): void {
	const previous = collisionTrees.get( items );

	if ( previous && previous.length === items.length ) {
		return;
	}

	const indices = Array.from( { length: items.length }, ( _, i ) => i );

	collisionTrees.set( items, {
		length: items.length,
		root: indices.length ? Collision_Build( items, indices ) : null,
		stack: [],
	} );
}

/**
 * @exec helper
 * ================
 * Collision_Invalidate
 *
 * Flushes cached BVH tree if collision geometry is dynamically modified.
 * ================
 */
export function Collision_Invalidate( items: readonly collision_bounds_t[] ): void {
	collisionTrees.delete( items );
}


// ---------------------------------------------------------------------------
// broadphase queries
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Collision_QueryBounds
 *
 * Queries BVH for all brushes overlapping the expanded swept AABB bounds.
 * Preserves ascending original index ordering for deterministic narrow-phase collision resolution.
 * ================
 */
export function Collision_QueryBounds(
	items: readonly collision_bounds_t[],
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	minZ: number,
	maxZ: number
): number[] {
	Collision_Prepare( items );

	const tree = collisionTrees.get( items )!;
	const result: number[] = [];
	const stack = tree.stack;

	stack.length = 0;

	if ( tree.root ) {
		stack.push( tree.root );
	}

	while ( stack.length ) {
		const node = stack.pop()!;
		const b = node.bounds;

		if (
			maxX < b[0] ||
			minX > b[1] ||
			maxY < b[2] ||
			minY > b[3] ||
			maxZ < b[4] ||
			minZ > b[5]
		) {
			continue;
		}

		if ( node.indices ) {
			for ( const index of node.indices ) {
				const p = items[index].bounds;

				if (
					!(
						maxX < p[0] ||
						minX > p[1] ||
						maxY < p[2] ||
						minY > p[3] ||
						maxZ < p[4] ||
						minZ > p[5]
					)
				) {
					result.push( index );
				}
			}
		} else {
			if ( node.right ) {
				stack.push( node.right );
			}
			if ( node.left ) {
				stack.push( node.left );
			}
		}
	}

	return result.sort( ( a, b ) => a - b );
}
