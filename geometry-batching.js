import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {getRenderer} from './renderer.js';
import {FreeList} from './geometry-util.js';
import {getBoundingSize} from './util.js';

const localVector2D = new THREE.Vector2();
const localMatrix = new THREE.Matrix4();
const localSphere = new THREE.Sphere();
const localBox = new THREE.Box3();
const localFrustum = new THREE.Frustum();
const localDataTexture = new THREE.DataTexture();

export class DrawCallBinding {
  constructor(geometryIndex, freeListEntry, allocator) {
    this.geometryIndex = geometryIndex;
    this.freeListEntry = freeListEntry;
    this.allocator = allocator;
  }
  getTexture(name) {
    return this.allocator.getTexture(name);
  }
  getTextureOffset(name) {
    const texture = this.getTexture(name);
    const {itemSize} = texture;
    return this.freeListEntry * this.allocator.maxInstancesPerDrawCall * itemSize;
  }
  getInstanceCount() {
    return this.allocator.getInstanceCount(this);
  }
  setInstanceCount(instanceCount) {
    this.allocator.setInstanceCount(this, instanceCount);
  }
  incrementInstanceCount() {
    return this.allocator.incrementInstanceCount(this);
  }
  decrementInstanceCount() {
    return this.allocator.decrementInstanceCount(this);
  }
  updateTexture(name, dataIndex, dataLength) {
    const texture = this.getTexture(name);

    let pixelIndex = dataIndex / texture.itemSize;
    let itemCount = dataLength / texture.itemSize;

    // update all pixels from pixelIndex to pixelIndex + itemCount
    // this requires up to 3 writes to the texture
    const renderer = getRenderer();

    let minX = pixelIndex % texture.image.width;
    let minY = Math.floor(pixelIndex / texture.image.width);
    let maxX = (pixelIndex + itemCount) % texture.image.width;
    let maxY = Math.floor((pixelIndex + itemCount) / texture.image.width);

    // top
    if (minX !== 0) {
      const x = minX;
      const y = minY;
      const w = Math.min(texture.image.width - x, itemCount);
      const h = 1;
      const position = localVector2D.set(x, y);
      const start = (x + y * texture.image.width) * texture.itemSize;
      const size = (w * h) * texture.itemSize;
      const data = texture.image.data.subarray(
        start,
        start + size
      );

      const srcTexture = localDataTexture;
      srcTexture.image.data = data;
      srcTexture.image.width = w;
      srcTexture.image.height = h;
      srcTexture.format = texture.format;
      srcTexture.type = texture.type;

      renderer.copyTextureToTexture(
        position,
        srcTexture,
        texture,
        0
      );

      srcTexture.image.data = null;

      minX = 0;
      minY++;

      pixelIndex += w * h; 
      itemCount -= w * h;
    }

    // middle
    if (minY < maxY) {
      const x = 0;
      const y = minY;
      const w = texture.image.width;
      const h = maxY - minY;
      const position = localVector2D.set(x, y);
      const start = (x + y * texture.image.width) * texture.itemSize;
      const size = (w * h) * texture.itemSize;
      const data = texture.image.data.subarray(
        start,
        start + size
      );

      const srcTexture = localDataTexture;
      srcTexture.image.data = data;
      srcTexture.image.width = w;
      srcTexture.image.height = h;
      srcTexture.format = texture.format;
      srcTexture.type = texture.type;

      renderer.copyTextureToTexture(
        position,
        srcTexture,
        texture,
      );

      srcTexture.image.data = null;

      minX = 0;
      minY = maxY;

      pixelIndex += w * h;
      itemCount -= w * h;
    }

    // bottom
    if (itemCount > 0) {
      const x = minX;
      const y = minY;
      const w = itemCount;
      const h = 1;
      const position = localVector2D.set(x, y);
      const start = (x + y * texture.image.width) * texture.itemSize;
      const size = (w * h) * texture.itemSize;
      const data = texture.image.data.subarray(
        start,
        start + size
      );

      const srcTexture = localDataTexture;
      srcTexture.image.data = data;
      srcTexture.image.width = w;
      srcTexture.image.height = h;
      srcTexture.format = texture.format;
      srcTexture.type = texture.type;

      renderer.copyTextureToTexture(
        position,
        srcTexture,
        texture,
      );

      srcTexture.image.data = null;
    }
  }
}

const _swapTextureAttributes = (texture, i, j, maxInstancesPerDrawCall) => {
  const {itemSize} = texture;
  const startOffset = i * maxInstancesPerDrawCall;
  const dstStart = (startOffset + j) * itemSize;
  const srcStart = (startOffset + maxInstancesPerDrawCall - 1) * itemSize;
  const count = itemSize;
  texture.image.data.copyWithin(
    dstStart,
    srcStart,
    srcStart + count
  );
};
const _swapBoundingDataSphere = (instanceBoundingData, i, j, maxInstancesPerDrawCall) => {
  const dstStart = (startOffset + j) * 4;
  const srcStart = (startOffset + maxInstancesPerDrawCall - 1) * 4;
  instanceBoundingData.copyWithin(
    dstStart,
    srcStart,
    srcStart + 4
  );
};
const _swapBoundingDataBox = (instanceBoundingData, i, j, maxInstancesPerDrawCall) => {
  const dstStart = (startOffset + j) * 6;
  const srcStart = (startOffset + maxInstancesPerDrawCall - 1) * 6;
  instanceBoundingData.copyWithin(
    dstStart,
    srcStart,
    srcStart + 6
  );
};
export class InstancedGeometryAllocator {
  constructor(geometries, instanceTextureSpecs, {
    maxInstancesPerDrawCall,
    maxDrawCallsPerGeometry,
    maxSlotsPerGeometry,
    boundingType = null,
    instanceBoundingType = null,
  }) {
    this.maxInstancesPerDrawCall = maxInstancesPerDrawCall;
    this.maxDrawCallsPerGeometry = maxDrawCallsPerGeometry;
    this.boundingType = boundingType;
    this.instanceBoundingType = instanceBoundingType;
    
    this.drawStarts = new Int32Array(geometries.length * maxDrawCallsPerGeometry);
    this.drawCounts = new Int32Array(geometries.length * maxDrawCallsPerGeometry);
    this.drawInstanceCounts = new Int32Array(geometries.length * maxDrawCallsPerGeometry);
    
    const boundingSize = getBoundingSize(boundingType);
    this.boundingData = new Float32Array(geometries.length * maxDrawCallsPerGeometry * boundingSize);
    const instanceBoundingSize = getBoundingSize(instanceBoundingType);
    this.instanceBoundingData = new Float32Array(geometries.length * maxDrawCallsPerGeometry * maxInstancesPerDrawCall * instanceBoundingSize);
 
    this.testBoundingFn = (() => {
      if (this.boundingType === 'sphere') {
        return (i, frustum) => {
          localSphere.center.fromArray(this.boundingData, i * 4);
          localSphere.radius = this.boundingData[i * 4 + 3];
          return frustum.intersectsSphere(localSphere);
        };
      } else if (this.boundingType === 'box') {
        return (i, frustum) => {
          localBox.min.fromArray(this.boundingData, i * 6);
          localBox.max.fromArray(this.boundingData, i * 6 + 3);
          return frustum.intersectsBox(localBox);
        };
      } else {
        return null;
      }
    })();
    this.swapBoundingDataFn = (() => {
      if (this.boundingType === 'sphere') {
        return _swapBoundingDataSphere;
      } else if (this.boundingType === 'box') {
        return _swapBoundingDataBox;
      } else {
        // throw new Error('Invalid bounding type: ' + this.boundingType);
        return null;
      }
    })();
    this.testInstanceBoundingFn = (() => {
      if (this.boundingType === 'sphere') {
        return (j, frustum) => {
          const sphereIndex = j;
          localSphere.center.fromArray(this.instanceBoundingData, sphereIndex * 4);
          localSphere.radius = this.instanceBoundingData[sphereIndex * 4 + 3];
          return frustum.intersectsSphere(localSphere);
        };
      } else if (this.boundingType === 'box') {
        return (j, frustum) => {
          const boxIndex = j;
          localBox.min.fromArray(this.boundingData, boxIndex * 6);
          localBox.max.fromArray(this.boundingData, boxIndex * 6 + 3);
          return frustum.intersectsBox(localBox);
        };
      } else {
        // throw new Error('Invalid bounding type: ' + this.boundingType);
        return null;
      }
    })();

    {
      const numGeometries = geometries.length;
      const geometryRegistry = Array(numGeometries);
      let positionIndex = 0;
      let indexIndex = 0;
      for (let i = 0; i < numGeometries; i++) {
        const geometry = geometries[i];

        const positionCount = geometry.attributes.position.count;
        const indexCount = geometry.index.count;
        const spec = {
          position: {
            start: positionIndex,
            count: positionCount,
          },
          index: {
            start: indexIndex,
            count: indexCount,
          },
        };
        geometryRegistry[i] = spec;

        positionIndex += positionCount;
        indexIndex += indexCount;
      }
      this.geometryRegistry = geometryRegistry;

      this.geometry = BufferGeometryUtils.mergeBufferGeometries(geometries);

      this.texturesArray = instanceTextureSpecs.map(spec => {
        const {
          name,
          Type,
          itemSize,
          instanced = true
        } = spec;

        // compute the minimum size of a texture that can hold the data

        let itemCount = numGeometries * maxDrawCallsPerGeometry * maxInstancesPerDrawCall;
        if ( !instanced ) {
          itemCount = maxSlotsPerGeometry * numGeometries;
        }
        let neededItems4 = itemCount;
        if (itemSize > 4) {
          neededItems4 *= itemSize / 4;
        }
        const textureSizePx = Math.min(Math.max(Math.pow(2, Math.ceil(Math.log2(Math.sqrt(neededItems4)))), 16), 2048);
        const itemSizeSnap = itemSize > 4 ? 4 : itemSize;
        // console.log('textureSizePx', name, textureSizePx, itemCount);

        const format = (() => {
          if (itemSize === 1) {
            return THREE.RedFormat;
          } else if (itemSize === 2) {
            return THREE.RGFormat;
          } else if (itemSize === 3) {
            return THREE.RGBFormat;
          } else /*if (itemSize >= 4)*/ {
            return THREE.RGBAFormat;
          }
        })();
        const type = (() => {
          if (Type === Float32Array) {
            return THREE.FloatType;
          } else if (Type === Uint32Array) {
            return THREE.UnsignedIntType;
          } else if (Type === Int32Array) {
            return THREE.IntType;
          } else if (Type === Uint16Array) {
            return THREE.UnsignedShortType;
          } else if (Type === Int16Array) {
            return THREE.ShortType;
          } else if (Type === Uint8Array) {
            return THREE.UnsignedByteType;
          } else if (Type === Int8Array) {
            return THREE.ByteType;
          } else {
            throw new Error('unsupported type: ' + type);
          }
        })();

        const data = new Type(textureSizePx * textureSizePx * itemSizeSnap);
        const texture = new THREE.DataTexture(data, textureSizePx, textureSizePx, format, type);
        texture.name = name;
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        // texture.flipY = true;
        texture.needsUpdate = true;
        texture.itemSize = itemSize;
        return texture;
      });
      this.textures = {};
      for (let i = 0; i < this.texturesArray.length; i++) {
        const textureSpec = instanceTextureSpecs[i];
        const {name} = textureSpec;
        this.textures[name] = this.texturesArray[i];
      }
      this.textureIndexes = {};
      for (let i = 0; i < this.texturesArray.length; i++) {
        const textureSpec = instanceTextureSpecs[i];
        const {name} = textureSpec;
        this.textureIndexes[name] = i;
      }

      this.freeList = new FreeList(numGeometries * maxDrawCallsPerGeometry);
    }
  }
  allocDrawCall(geometryIndex, boundingObject) {
    const freeListEntry = this.freeList.alloc(1);
    const drawCall = new DrawCallBinding(geometryIndex, freeListEntry, this);

    const geometrySpec = this.geometryRegistry[geometryIndex];
    const {
      index: {
        start,
        count,
      },
    } = geometrySpec;

    this.drawStarts[freeListEntry] = start * this.geometry.index.array.BYTES_PER_ELEMENT;
    this.drawCounts[freeListEntry] = count;
    this.drawInstanceCounts[freeListEntry] = 0;
    if (this.boundingType === 'sphere') {
      boundingObject.center.toArray(this.boundingData, freeListEntry  * 4);
      this.boundingData[freeListEntry * 4 + 3] = boundingObject.radius;
    } else if (this.boundingType === 'box') {
      boundingObject.min.toArray(this.boundingData, freeListEntry * 6);
      boundingObject.max.toArray(this.boundingData, freeListEntry * 6 + 3);
    }
    
    return drawCall;
  }
  freeDrawCall(drawCall) {
    const {freeListEntry} = drawCall;

    this.drawStarts[freeListEntry] = 0;
    this.drawCounts[freeListEntry] = 0;
    this.drawInstanceCounts[freeListEntry] = 0;
    if (this.boundingType === 'sphere') {
      this.boundingData[freeListEntry * 4] = 0;
      this.boundingData[freeListEntry * 4 + 1] = 0;
      this.boundingData[freeListEntry * 4 + 2] = 0;
      this.boundingData[freeListEntry * 4 + 3] = 0;
    } else if (this.boundingType === 'box') {
      this.boundingData[freeListEntry * 6] = 0;
      this.boundingData[freeListEntry * 6 + 1] = 0;
      this.boundingData[freeListEntry * 6 + 2] = 0;
      this.boundingData[freeListEntry * 6 + 3] = 0;
      this.boundingData[freeListEntry * 6 + 4] = 0;
      this.boundingData[freeListEntry * 6 + 5] = 0;
    }

    this.freeList.free(freeListEntry);
  }
  getInstanceCount(drawCall) {
    return this.drawInstanceCounts[drawCall.freeListEntry];
  }
  setInstanceCount(drawCall, instanceCount) {
    this.drawInstanceCounts[drawCall.freeListEntry] = instanceCount;
  }
  incrementInstanceCount(drawCall) {
    this.drawInstanceCounts[drawCall.freeListEntry]++;
  }
  decrementInstanceCount(drawCall) {
    this.drawInstanceCounts[drawCall.freeListEntry]--;
  }
  getTexture(name) {
    return this.textures[name];
  }
  getDrawSpec(camera, multiDrawStarts, multiDrawCounts, multiDrawInstanceCounts) {
    multiDrawStarts.length = this.drawStarts.length;
    multiDrawCounts.length = this.drawCounts.length;
    multiDrawInstanceCounts.length = this.drawInstanceCounts.length;

    if (this.testBoundingFn || this.testInstanceBoundingFn) {
      const projScreenMatrix = localMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      localFrustum.setFromProjectionMatrix(projScreenMatrix);
    }

    for (let i = 0; i < this.drawStarts.length; i++) {
      if (!this.testBoundingFn || this.testBoundingFn(i, localFrustum)) {
        multiDrawStarts[i] = this.drawStarts[i];
        multiDrawCounts[i] = this.drawCounts[i];
        
        if (this.instanceBoundingType) {
          const startOffset = i * this.maxInstancesPerDrawCall;

          // arrange the instanced draw list :
          // - apply per-instance frustum culling
          // - swapping the bounding data into place
          // - accumulate the real instance draw count
          const maxDrawableInstances = this.drawInstanceCounts[i];
          let instancesToDraw = 0;
          for (let j = 0; j < maxDrawableInstances; j++) {
            if (!this.testInstanceBoundingFn || this.testInstanceBoundingFn(startOffset + j, localFrustum)) {
              instancesToDraw++;
            } else {
              // swap this instance with the last instance to remove it
              for (const texture of this.texturesArray) {
                _swapTextureAttributes(texture, i, j, this.maxInstancesPerDrawCall);
              }
              if (this.swapBoundingDataFn) {
                  this.swapBoundingDataFn(this.instanceBoundingData, i, j, this.maxInstancesPerDrawCall);
              }
            }
          }

          multiDrawInstanceCounts[i] = instancesToDraw;
        } else {
          multiDrawInstanceCounts[i] = this.drawInstanceCounts[i];
        }
      } else {
        multiDrawStarts[i] = 0;
        multiDrawCounts[i] = 0;
        multiDrawInstanceCounts[i] = 0;
      }
    }
  }
}

export class InstancedBatchedMesh extends THREE.InstancedMesh {
  constructor(geometry, material, allocator) {
    super(geometry, material);
    
    this.isBatchedMesh = true;
    this.allocator = allocator;
  }
	getDrawSpec(camera, multiDrawStarts, multiDrawCounts, multiDrawInstanceCounts) {
    this.allocator.getDrawSpec(camera, multiDrawStarts, multiDrawCounts, multiDrawInstanceCounts);
  }
}