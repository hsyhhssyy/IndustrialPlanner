;(function () {
  'use strict'

  var typedArrayConstructors = [
    typeof Int8Array === 'function' ? Int8Array : null,
    typeof Uint8Array === 'function' ? Uint8Array : null,
    typeof Uint8ClampedArray === 'function' ? Uint8ClampedArray : null,
    typeof Int16Array === 'function' ? Int16Array : null,
    typeof Uint16Array === 'function' ? Uint16Array : null,
    typeof Int32Array === 'function' ? Int32Array : null,
    typeof Uint32Array === 'function' ? Uint32Array : null,
    typeof Float32Array === 'function' ? Float32Array : null,
    typeof Float64Array === 'function' ? Float64Array : null,
    typeof BigInt64Array === 'function' ? BigInt64Array : null,
    typeof BigUint64Array === 'function' ? BigUint64Array : null,
  ]

  function toIntegerOrInfinity(value) {
    var numberValue = Number(value)

    if (numberValue === 0 || Number.isNaN(numberValue)) {
      return 0
    }

    if (!Number.isFinite(numberValue)) {
      return numberValue
    }

    return numberValue < 0 ? Math.ceil(numberValue) : Math.floor(numberValue)
  }

  function toLength(value) {
    var length = toIntegerOrInfinity(value)

    if (length <= 0) {
      return 0
    }

    return Math.min(length, 9007199254740991)
  }

  function resolveRelativeIndex(length, index) {
    var relativeIndex = toIntegerOrInfinity(index)

    return relativeIndex >= 0 ? relativeIndex : length + relativeIndex
  }

  function arrayLikeAt(index) {
    if (this === null || this === undefined) {
      throw new TypeError('Array.prototype.at called on null or undefined')
    }

    var target = Object(this)
    var length = toLength(target.length)
    var resolvedIndex = resolveRelativeIndex(length, index)

    if (resolvedIndex < 0 || resolvedIndex >= length) {
      return undefined
    }

    return target[resolvedIndex]
  }

  function stringAt(index) {
    if (this === null || this === undefined) {
      throw new TypeError('String.prototype.at called on null or undefined')
    }

    var target = String(this)
    var length = target.length
    var resolvedIndex = resolveRelativeIndex(length, index)

    if (resolvedIndex < 0 || resolvedIndex >= length) {
      return undefined
    }

    return target.charAt(resolvedIndex)
  }

  function defineAt(prototype, implementation) {
    if (prototype === null || prototype === undefined || typeof prototype.at === 'function') {
      return
    }

    try {
      Object.defineProperty(prototype, 'at', {
        configurable: true,
        enumerable: false,
        value: implementation,
        writable: true,
      })
    } catch {
      prototype.at = implementation
    }
  }

  defineAt(Array.prototype, arrayLikeAt)
  defineAt(String.prototype, stringAt)

  for (var index = 0; index < typedArrayConstructors.length; index += 1) {
    var TypedArrayConstructor = typedArrayConstructors[index]

    if (TypedArrayConstructor !== null) {
      defineAt(TypedArrayConstructor.prototype, arrayLikeAt)
    }
  }
})()
