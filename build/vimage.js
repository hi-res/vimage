(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  function Bar () {}
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    arr.constructor = Bar
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Bar && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []
  var i = 0

  for (; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (leadSurrogate) {
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        } else {
          // valid surrogate pair
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      } else {
        // no lead yet

        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else {
          // valid lead
          leadSurrogate = codePoint
          continue
        }
      }
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-coffeeify/node_modules/browserify/node_modules/buffer/index.js","/../node_modules/gulp-coffeeify/node_modules/browserify/node_modules/buffer")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIi8qIVxuICogVGhlIGJ1ZmZlciBtb2R1bGUgZnJvbSBub2RlLmpzLCBmb3IgdGhlIGJyb3dzZXIuXG4gKlxuICogQGF1dGhvciAgIEZlcm9zcyBBYm91a2hhZGlqZWggPGZlcm9zc0BmZXJvc3Mub3JnPiA8aHR0cDovL2Zlcm9zcy5vcmc+XG4gKiBAbGljZW5zZSAgTUlUXG4gKi9cblxudmFyIGJhc2U2NCA9IHJlcXVpcmUoJ2Jhc2U2NC1qcycpXG52YXIgaWVlZTc1NCA9IHJlcXVpcmUoJ2llZWU3NTQnKVxudmFyIGlzQXJyYXkgPSByZXF1aXJlKCdpcy1hcnJheScpXG5cbmV4cG9ydHMuQnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLlNsb3dCdWZmZXIgPSBTbG93QnVmZmVyXG5leHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTID0gNTBcbkJ1ZmZlci5wb29sU2l6ZSA9IDgxOTIgLy8gbm90IHVzZWQgYnkgdGhpcyBpbXBsZW1lbnRhdGlvblxuXG52YXIgcm9vdFBhcmVudCA9IHt9XG5cbi8qKlxuICogSWYgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYDpcbiAqICAgPT09IHRydWUgICAgVXNlIFVpbnQ4QXJyYXkgaW1wbGVtZW50YXRpb24gKGZhc3Rlc3QpXG4gKiAgID09PSBmYWxzZSAgIFVzZSBPYmplY3QgaW1wbGVtZW50YXRpb24gKG1vc3QgY29tcGF0aWJsZSwgZXZlbiBJRTYpXG4gKlxuICogQnJvd3NlcnMgdGhhdCBzdXBwb3J0IHR5cGVkIGFycmF5cyBhcmUgSUUgMTArLCBGaXJlZm94IDQrLCBDaHJvbWUgNyssIFNhZmFyaSA1LjErLFxuICogT3BlcmEgMTEuNissIGlPUyA0LjIrLlxuICpcbiAqIER1ZSB0byB2YXJpb3VzIGJyb3dzZXIgYnVncywgc29tZXRpbWVzIHRoZSBPYmplY3QgaW1wbGVtZW50YXRpb24gd2lsbCBiZSB1c2VkIGV2ZW5cbiAqIHdoZW4gdGhlIGJyb3dzZXIgc3VwcG9ydHMgdHlwZWQgYXJyYXlzLlxuICpcbiAqIE5vdGU6XG4gKlxuICogICAtIEZpcmVmb3ggNC0yOSBsYWNrcyBzdXBwb3J0IGZvciBhZGRpbmcgbmV3IHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgIGluc3RhbmNlcyxcbiAqICAgICBTZWU6IGh0dHBzOi8vYnVnemlsbGEubW96aWxsYS5vcmcvc2hvd19idWcuY2dpP2lkPTY5NTQzOC5cbiAqXG4gKiAgIC0gU2FmYXJpIDUtNyBsYWNrcyBzdXBwb3J0IGZvciBjaGFuZ2luZyB0aGUgYE9iamVjdC5wcm90b3R5cGUuY29uc3RydWN0b3JgIHByb3BlcnR5XG4gKiAgICAgb24gb2JqZWN0cy5cbiAqXG4gKiAgIC0gQ2hyb21lIDktMTAgaXMgbWlzc2luZyB0aGUgYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbi5cbiAqXG4gKiAgIC0gSUUxMCBoYXMgYSBicm9rZW4gYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbiB3aGljaCByZXR1cm5zIGFycmF5cyBvZlxuICogICAgIGluY29ycmVjdCBsZW5ndGggaW4gc29tZSBzaXR1YXRpb25zLlxuXG4gKiBXZSBkZXRlY3QgdGhlc2UgYnVnZ3kgYnJvd3NlcnMgYW5kIHNldCBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgIHRvIGBmYWxzZWAgc28gdGhleVxuICogZ2V0IHRoZSBPYmplY3QgaW1wbGVtZW50YXRpb24sIHdoaWNoIGlzIHNsb3dlciBidXQgYmVoYXZlcyBjb3JyZWN0bHkuXG4gKi9cbkJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUID0gKGZ1bmN0aW9uICgpIHtcbiAgZnVuY3Rpb24gQmFyICgpIHt9XG4gIHRyeSB7XG4gICAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KDEpXG4gICAgYXJyLmZvbyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIDQyIH1cbiAgICBhcnIuY29uc3RydWN0b3IgPSBCYXJcbiAgICByZXR1cm4gYXJyLmZvbygpID09PSA0MiAmJiAvLyB0eXBlZCBhcnJheSBpbnN0YW5jZXMgY2FuIGJlIGF1Z21lbnRlZFxuICAgICAgICBhcnIuY29uc3RydWN0b3IgPT09IEJhciAmJiAvLyBjb25zdHJ1Y3RvciBjYW4gYmUgc2V0XG4gICAgICAgIHR5cGVvZiBhcnIuc3ViYXJyYXkgPT09ICdmdW5jdGlvbicgJiYgLy8gY2hyb21lIDktMTAgbGFjayBgc3ViYXJyYXlgXG4gICAgICAgIGFyci5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufSkoKVxuXG5mdW5jdGlvbiBrTWF4TGVuZ3RoICgpIHtcbiAgcmV0dXJuIEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUXG4gICAgPyAweDdmZmZmZmZmXG4gICAgOiAweDNmZmZmZmZmXG59XG5cbi8qKlxuICogQ2xhc3M6IEJ1ZmZlclxuICogPT09PT09PT09PT09PVxuICpcbiAqIFRoZSBCdWZmZXIgY29uc3RydWN0b3IgcmV0dXJucyBpbnN0YW5jZXMgb2YgYFVpbnQ4QXJyYXlgIHRoYXQgYXJlIGF1Z21lbnRlZFxuICogd2l0aCBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciBhbGwgdGhlIG5vZGUgYEJ1ZmZlcmAgQVBJIGZ1bmN0aW9ucy4gV2UgdXNlXG4gKiBgVWludDhBcnJheWAgc28gdGhhdCBzcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdCByZXR1cm5zXG4gKiBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBCeSBhdWdtZW50aW5nIHRoZSBpbnN0YW5jZXMsIHdlIGNhbiBhdm9pZCBtb2RpZnlpbmcgdGhlIGBVaW50OEFycmF5YFxuICogcHJvdG90eXBlLlxuICovXG5mdW5jdGlvbiBCdWZmZXIgKGFyZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSkge1xuICAgIC8vIEF2b2lkIGdvaW5nIHRocm91Z2ggYW4gQXJndW1lbnRzQWRhcHRvclRyYW1wb2xpbmUgaW4gdGhlIGNvbW1vbiBjYXNlLlxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkgcmV0dXJuIG5ldyBCdWZmZXIoYXJnLCBhcmd1bWVudHNbMV0pXG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoYXJnKVxuICB9XG5cbiAgdGhpcy5sZW5ndGggPSAwXG4gIHRoaXMucGFyZW50ID0gdW5kZWZpbmVkXG5cbiAgLy8gQ29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnbnVtYmVyJykge1xuICAgIHJldHVybiBmcm9tTnVtYmVyKHRoaXMsIGFyZylcbiAgfVxuXG4gIC8vIFNsaWdodGx5IGxlc3MgY29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBmcm9tU3RyaW5nKHRoaXMsIGFyZywgYXJndW1lbnRzLmxlbmd0aCA+IDEgPyBhcmd1bWVudHNbMV0gOiAndXRmOCcpXG4gIH1cblxuICAvLyBVbnVzdWFsLlxuICByZXR1cm4gZnJvbU9iamVjdCh0aGlzLCBhcmcpXG59XG5cbmZ1bmN0aW9uIGZyb21OdW1iZXIgKHRoYXQsIGxlbmd0aCkge1xuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoIDwgMCA/IDAgOiBjaGVja2VkKGxlbmd0aCkgfCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgdGhhdFtpXSA9IDBcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbVN0cmluZyAodGhhdCwgc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIGVuY29kaW5nICE9PSAnc3RyaW5nJyB8fCBlbmNvZGluZyA9PT0gJycpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgLy8gQXNzdW1wdGlvbjogYnl0ZUxlbmd0aCgpIHJldHVybiB2YWx1ZSBpcyBhbHdheXMgPCBrTWF4TGVuZ3RoLlxuICB2YXIgbGVuZ3RoID0gYnl0ZUxlbmd0aChzdHJpbmcsIGVuY29kaW5nKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICB0aGF0LndyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICBpZiAoQnVmZmVyLmlzQnVmZmVyKG9iamVjdCkpIHJldHVybiBmcm9tQnVmZmVyKHRoYXQsIG9iamVjdClcblxuICBpZiAoaXNBcnJheShvYmplY3QpKSByZXR1cm4gZnJvbUFycmF5KHRoYXQsIG9iamVjdClcblxuICBpZiAob2JqZWN0ID09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtdXN0IHN0YXJ0IHdpdGggbnVtYmVyLCBidWZmZXIsIGFycmF5IG9yIHN0cmluZycpXG4gIH1cblxuICBpZiAodHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmIChvYmplY3QuYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICAgIHJldHVybiBmcm9tVHlwZWRBcnJheSh0aGF0LCBvYmplY3QpXG4gICAgfVxuICAgIGlmIChvYmplY3QgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgICAgcmV0dXJuIGZyb21BcnJheUJ1ZmZlcih0aGF0LCBvYmplY3QpXG4gICAgfVxuICB9XG5cbiAgaWYgKG9iamVjdC5sZW5ndGgpIHJldHVybiBmcm9tQXJyYXlMaWtlKHRoYXQsIG9iamVjdClcblxuICByZXR1cm4gZnJvbUpzb25PYmplY3QodGhhdCwgb2JqZWN0KVxufVxuXG5mdW5jdGlvbiBmcm9tQnVmZmVyICh0aGF0LCBidWZmZXIpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYnVmZmVyLmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGJ1ZmZlci5jb3B5KHRoYXQsIDAsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5ICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLy8gRHVwbGljYXRlIG9mIGZyb21BcnJheSgpIHRvIGtlZXAgZnJvbUFycmF5KCkgbW9ub21vcnBoaWMuXG5mdW5jdGlvbiBmcm9tVHlwZWRBcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgLy8gVHJ1bmNhdGluZyB0aGUgZWxlbWVudHMgaXMgcHJvYmFibHkgbm90IHdoYXQgcGVvcGxlIGV4cGVjdCBmcm9tIHR5cGVkXG4gIC8vIGFycmF5cyB3aXRoIEJZVEVTX1BFUl9FTEVNRU5UID4gMSBidXQgaXQncyBjb21wYXRpYmxlIHdpdGggdGhlIGJlaGF2aW9yXG4gIC8vIG9mIHRoZSBvbGQgQnVmZmVyIGNvbnN0cnVjdG9yLlxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5QnVmZmVyICh0aGF0LCBhcnJheSkge1xuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSwgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICBhcnJheS5ieXRlTGVuZ3RoXG4gICAgdGhhdCA9IEJ1ZmZlci5fYXVnbWVudChuZXcgVWludDhBcnJheShhcnJheSkpXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBhbiBvYmplY3QgaW5zdGFuY2Ugb2YgdGhlIEJ1ZmZlciBjbGFzc1xuICAgIHRoYXQgPSBmcm9tVHlwZWRBcnJheSh0aGF0LCBuZXcgVWludDhBcnJheShhcnJheSkpXG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5TGlrZSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIERlc2VyaWFsaXplIHsgdHlwZTogJ0J1ZmZlcicsIGRhdGE6IFsxLDIsMywuLi5dIH0gaW50byBhIEJ1ZmZlciBvYmplY3QuXG4vLyBSZXR1cm5zIGEgemVyby1sZW5ndGggYnVmZmVyIGZvciBpbnB1dHMgdGhhdCBkb24ndCBjb25mb3JtIHRvIHRoZSBzcGVjLlxuZnVuY3Rpb24gZnJvbUpzb25PYmplY3QgKHRoYXQsIG9iamVjdCkge1xuICB2YXIgYXJyYXlcbiAgdmFyIGxlbmd0aCA9IDBcblxuICBpZiAob2JqZWN0LnR5cGUgPT09ICdCdWZmZXInICYmIGlzQXJyYXkob2JqZWN0LmRhdGEpKSB7XG4gICAgYXJyYXkgPSBvYmplY3QuZGF0YVxuICAgIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgfVxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBhbGxvY2F0ZSAodGhhdCwgbGVuZ3RoKSB7XG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlLCBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIHRoYXQgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkobGVuZ3RoKSlcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIGFuIG9iamVjdCBpbnN0YW5jZSBvZiB0aGUgQnVmZmVyIGNsYXNzXG4gICAgdGhhdC5sZW5ndGggPSBsZW5ndGhcbiAgICB0aGF0Ll9pc0J1ZmZlciA9IHRydWVcbiAgfVxuXG4gIHZhciBmcm9tUG9vbCA9IGxlbmd0aCAhPT0gMCAmJiBsZW5ndGggPD0gQnVmZmVyLnBvb2xTaXplID4+PiAxXG4gIGlmIChmcm9tUG9vbCkgdGhhdC5wYXJlbnQgPSByb290UGFyZW50XG5cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gY2hlY2tlZCAobGVuZ3RoKSB7XG4gIC8vIE5vdGU6IGNhbm5vdCB1c2UgYGxlbmd0aCA8IGtNYXhMZW5ndGhgIGhlcmUgYmVjYXVzZSB0aGF0IGZhaWxzIHdoZW5cbiAgLy8gbGVuZ3RoIGlzIE5hTiAod2hpY2ggaXMgb3RoZXJ3aXNlIGNvZXJjZWQgdG8gemVyby4pXG4gIGlmIChsZW5ndGggPj0ga01heExlbmd0aCgpKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgJ3NpemU6IDB4JyArIGtNYXhMZW5ndGgoKS50b1N0cmluZygxNikgKyAnIGJ5dGVzJylcbiAgfVxuICByZXR1cm4gbGVuZ3RoIHwgMFxufVxuXG5mdW5jdGlvbiBTbG93QnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgU2xvd0J1ZmZlcikpIHJldHVybiBuZXcgU2xvd0J1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcbiAgZGVsZXRlIGJ1Zi5wYXJlbnRcbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuaXNCdWZmZXIgPSBmdW5jdGlvbiBpc0J1ZmZlciAoYikge1xuICByZXR1cm4gISEoYiAhPSBudWxsICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGEsIGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYSkgfHwgIUJ1ZmZlci5pc0J1ZmZlcihiKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyBtdXN0IGJlIEJ1ZmZlcnMnKVxuICB9XG5cbiAgaWYgKGEgPT09IGIpIHJldHVybiAwXG5cbiAgdmFyIHggPSBhLmxlbmd0aFxuICB2YXIgeSA9IGIubGVuZ3RoXG5cbiAgdmFyIGkgPSAwXG4gIHZhciBsZW4gPSBNYXRoLm1pbih4LCB5KVxuICB3aGlsZSAoaSA8IGxlbikge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSBicmVha1xuXG4gICAgKytpXG4gIH1cblxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG5cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIGlzRW5jb2RpbmcgKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICBjYXNlICdyYXcnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gY29uY2F0IChsaXN0LCBsZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0IGFyZ3VtZW50IG11c3QgYmUgYW4gQXJyYXkgb2YgQnVmZmVycy4nKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH1cblxuICB2YXIgaVxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICBsZW5ndGggPSAwXG4gICAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgIGxlbmd0aCArPSBsaXN0W2ldLmxlbmd0aFxuICAgIH1cbiAgfVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKGxlbmd0aClcbiAgdmFyIHBvcyA9IDBcbiAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgaXRlbSA9IGxpc3RbaV1cbiAgICBpdGVtLmNvcHkoYnVmLCBwb3MpXG4gICAgcG9zICs9IGl0ZW0ubGVuZ3RoXG4gIH1cbiAgcmV0dXJuIGJ1ZlxufVxuXG5mdW5jdGlvbiBieXRlTGVuZ3RoIChzdHJpbmcsIGVuY29kaW5nKSB7XG4gIGlmICh0eXBlb2Ygc3RyaW5nICE9PSAnc3RyaW5nJykgc3RyaW5nID0gJycgKyBzdHJpbmdcblxuICB2YXIgbGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAobGVuID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIFVzZSBhIGZvciBsb29wIHRvIGF2b2lkIHJlY3Vyc2lvblxuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuICBmb3IgKDs7KSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgIC8vIERlcHJlY2F0ZWRcbiAgICAgIGNhc2UgJ3Jhdyc6XG4gICAgICBjYXNlICdyYXdzJzpcbiAgICAgICAgcmV0dXJuIGxlblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIGxlbiAqIDJcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBsZW4gPj4+IDFcbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHJldHVybiBiYXNlNjRUb0J5dGVzKHN0cmluZykubGVuZ3RoXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHJldHVybiB1dGY4VG9CeXRlcyhzdHJpbmcpLmxlbmd0aCAvLyBhc3N1bWUgdXRmOFxuICAgICAgICBlbmNvZGluZyA9ICgnJyArIGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuQnVmZmVyLmJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoXG5cbi8vIHByZS1zZXQgZm9yIHZhbHVlcyB0aGF0IG1heSBleGlzdCBpbiB0aGUgZnV0dXJlXG5CdWZmZXIucHJvdG90eXBlLmxlbmd0aCA9IHVuZGVmaW5lZFxuQnVmZmVyLnByb3RvdHlwZS5wYXJlbnQgPSB1bmRlZmluZWRcblxuZnVuY3Rpb24gc2xvd1RvU3RyaW5nIChlbmNvZGluZywgc3RhcnQsIGVuZCkge1xuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuXG4gIHN0YXJ0ID0gc3RhcnQgfCAwXG4gIGVuZCA9IGVuZCA9PT0gdW5kZWZpbmVkIHx8IGVuZCA9PT0gSW5maW5pdHkgPyB0aGlzLmxlbmd0aCA6IGVuZCB8IDBcblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAoZW5kIDw9IHN0YXJ0KSByZXR1cm4gJydcblxuICB3aGlsZSAodHJ1ZSkge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBoZXhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICAgIHJldHVybiBhc2NpaVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIHJldHVybiBiaW5hcnlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIHV0ZjE2bGVTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoZW5jb2RpbmcgKyAnJykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uIHRvU3RyaW5nICgpIHtcbiAgdmFyIGxlbmd0aCA9IHRoaXMubGVuZ3RoIHwgMFxuICBpZiAobGVuZ3RoID09PSAwKSByZXR1cm4gJydcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHJldHVybiB1dGY4U2xpY2UodGhpcywgMCwgbGVuZ3RoKVxuICByZXR1cm4gc2xvd1RvU3RyaW5nLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbiBlcXVhbHMgKGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICBpZiAodGhpcyA9PT0gYikgcmV0dXJuIHRydWVcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpID09PSAwXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5zcGVjdCA9IGZ1bmN0aW9uIGluc3BlY3QgKCkge1xuICB2YXIgc3RyID0gJydcbiAgdmFyIG1heCA9IGV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVNcbiAgaWYgKHRoaXMubGVuZ3RoID4gMCkge1xuICAgIHN0ciA9IHRoaXMudG9TdHJpbmcoJ2hleCcsIDAsIG1heCkubWF0Y2goLy57Mn0vZykuam9pbignICcpXG4gICAgaWYgKHRoaXMubGVuZ3RoID4gbWF4KSBzdHIgKz0gJyAuLi4gJ1xuICB9XG4gIHJldHVybiAnPEJ1ZmZlciAnICsgc3RyICsgJz4nXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICBpZiAodGhpcyA9PT0gYikgcmV0dXJuIDBcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5kZXhPZiA9IGZ1bmN0aW9uIGluZGV4T2YgKHZhbCwgYnl0ZU9mZnNldCkge1xuICBpZiAoYnl0ZU9mZnNldCA+IDB4N2ZmZmZmZmYpIGJ5dGVPZmZzZXQgPSAweDdmZmZmZmZmXG4gIGVsc2UgaWYgKGJ5dGVPZmZzZXQgPCAtMHg4MDAwMDAwMCkgYnl0ZU9mZnNldCA9IC0weDgwMDAwMDAwXG4gIGJ5dGVPZmZzZXQgPj49IDBcblxuICBpZiAodGhpcy5sZW5ndGggPT09IDApIHJldHVybiAtMVxuICBpZiAoYnl0ZU9mZnNldCA+PSB0aGlzLmxlbmd0aCkgcmV0dXJuIC0xXG5cbiAgLy8gTmVnYXRpdmUgb2Zmc2V0cyBzdGFydCBmcm9tIHRoZSBlbmQgb2YgdGhlIGJ1ZmZlclxuICBpZiAoYnl0ZU9mZnNldCA8IDApIGJ5dGVPZmZzZXQgPSBNYXRoLm1heCh0aGlzLmxlbmd0aCArIGJ5dGVPZmZzZXQsIDApXG5cbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdzdHJpbmcnKSB7XG4gICAgaWYgKHZhbC5sZW5ndGggPT09IDApIHJldHVybiAtMSAvLyBzcGVjaWFsIGNhc2U6IGxvb2tpbmcgZm9yIGVtcHR5IHN0cmluZyBhbHdheXMgZmFpbHNcbiAgICByZXR1cm4gU3RyaW5nLnByb3RvdHlwZS5pbmRleE9mLmNhbGwodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICB9XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIodmFsKSkge1xuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICB9XG4gIGlmICh0eXBlb2YgdmFsID09PSAnbnVtYmVyJykge1xuICAgIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCAmJiBVaW50OEFycmF5LnByb3RvdHlwZS5pbmRleE9mID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgICB9XG4gICAgcmV0dXJuIGFycmF5SW5kZXhPZih0aGlzLCBbIHZhbCBdLCBieXRlT2Zmc2V0KVxuICB9XG5cbiAgZnVuY3Rpb24gYXJyYXlJbmRleE9mIChhcnIsIHZhbCwgYnl0ZU9mZnNldCkge1xuICAgIHZhciBmb3VuZEluZGV4ID0gLTFcbiAgICBmb3IgKHZhciBpID0gMDsgYnl0ZU9mZnNldCArIGkgPCBhcnIubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChhcnJbYnl0ZU9mZnNldCArIGldID09PSB2YWxbZm91bmRJbmRleCA9PT0gLTEgPyAwIDogaSAtIGZvdW5kSW5kZXhdKSB7XG4gICAgICAgIGlmIChmb3VuZEluZGV4ID09PSAtMSkgZm91bmRJbmRleCA9IGlcbiAgICAgICAgaWYgKGkgLSBmb3VuZEluZGV4ICsgMSA9PT0gdmFsLmxlbmd0aCkgcmV0dXJuIGJ5dGVPZmZzZXQgKyBmb3VuZEluZGV4XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3VuZEluZGV4ID0gLTFcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIC0xXG4gIH1cblxuICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWwgbXVzdCBiZSBzdHJpbmcsIG51bWJlciBvciBCdWZmZXInKVxufVxuXG4vLyBgZ2V0YCBpcyBkZXByZWNhdGVkXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIGdldCAob2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuZ2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy5yZWFkVUludDgob2Zmc2V0KVxufVxuXG4vLyBgc2V0YCBpcyBkZXByZWNhdGVkXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIHNldCAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAoc3RyTGVuICUgMiAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFyc2VkID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChpc05hTihwYXJzZWQpKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gcGFyc2VkXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIHVjczJXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiB3cml0ZSAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZylcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZW5jb2RpbmcgPSAndXRmOCdcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIG9mZnNldCA9PT0gJ3N0cmluZycpIHtcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBvZmZzZXRbLCBsZW5ndGhdWywgZW5jb2RpbmddKVxuICB9IGVsc2UgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gICAgaWYgKGlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGxlbmd0aCA9IGxlbmd0aCB8IDBcbiAgICAgIGlmIChlbmNvZGluZyA9PT0gdW5kZWZpbmVkKSBlbmNvZGluZyA9ICd1dGY4J1xuICAgIH0gZWxzZSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICAvLyBsZWdhY3kgd3JpdGUoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpIC0gcmVtb3ZlIGluIHYwLjEzXG4gIH0gZWxzZSB7XG4gICAgdmFyIHN3YXAgPSBlbmNvZGluZ1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgb2Zmc2V0ID0gbGVuZ3RoIHwgMFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgfHwgbGVuZ3RoID4gcmVtYWluaW5nKSBsZW5ndGggPSByZW1haW5pbmdcblxuICBpZiAoKHN0cmluZy5sZW5ndGggPiAwICYmIChsZW5ndGggPCAwIHx8IG9mZnNldCA8IDApKSB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdhdHRlbXB0IHRvIHdyaXRlIG91dHNpZGUgYnVmZmVyIGJvdW5kcycpXG4gIH1cblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgLy8gV2FybmluZzogbWF4TGVuZ3RoIG5vdCB0YWtlbiBpbnRvIGFjY291bnQgaW4gYmFzZTY0V3JpdGVcbiAgICAgICAgcmV0dXJuIGJhc2U2NFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1Y3MyV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9KU09OID0gZnVuY3Rpb24gdG9KU09OICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG5mdW5jdGlvbiBiYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gdXRmOFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlcyA9ICcnXG4gIHZhciB0bXAgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBpZiAoYnVmW2ldIDw9IDB4N0YpIHtcbiAgICAgIHJlcyArPSBkZWNvZGVVdGY4Q2hhcih0bXApICsgU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gICAgICB0bXAgPSAnJ1xuICAgIH0gZWxzZSB7XG4gICAgICB0bXAgKz0gJyUnICsgYnVmW2ldLnRvU3RyaW5nKDE2KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXMgKyBkZWNvZGVVdGY4Q2hhcih0bXApXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldICYgMHg3RilcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGJpbmFyeVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gc2xpY2UgKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlblxuICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKSBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgdmFyIG5ld0J1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBuZXdCdWYgPSBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZClcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfVxuXG4gIGlmIChuZXdCdWYubGVuZ3RoKSBuZXdCdWYucGFyZW50ID0gdGhpcy5wYXJlbnQgfHwgdGhpc1xuXG4gIHJldHVybiBuZXdCdWZcbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRMRSA9IGZ1bmN0aW9uIHJlYWRVSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRCRSA9IGZ1bmN0aW9uIHJlYWRVSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG4gIH1cblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdXG4gIHZhciBtdWwgPSAxXG4gIHdoaWxlIChieXRlTGVuZ3RoID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiByZWFkVUludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiByZWFkVUludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludExFID0gZnVuY3Rpb24gcmVhZEludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludEJFID0gZnVuY3Rpb24gcmVhZEludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoXG4gIHZhciBtdWwgPSAxXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0taV1cbiAgd2hpbGUgKGkgPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1pXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiByZWFkSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICBpZiAoISh0aGlzW29mZnNldF0gJiAweDgwKSkgcmV0dXJuICh0aGlzW29mZnNldF0pXG4gIHJldHVybiAoKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gcmVhZEludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiByZWFkSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdKSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10gPDwgMjQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiByZWFkSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiByZWFkRmxvYXRMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiByZWFkRmxvYXRCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gcmVhZERvdWJsZUJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignYnVmZmVyIG11c3QgYmUgYSBCdWZmZXIgaW5zdGFuY2UnKVxuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludExFID0gZnVuY3Rpb24gd3JpdGVVSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludEJFID0gZnVuY3Rpb24gd3JpdGVVSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiB3cml0ZVVJbnQ4ICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludExFID0gZnVuY3Rpb24gd3JpdGVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IDBcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gdmFsdWUgPCAwID8gMSA6IDBcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uIHdyaXRlSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbiAgaWYgKG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5mdW5jdGlvbiB3cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDQsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gd3JpdGVGbG9hdEJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDgsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG4gIHJldHVybiBvZmZzZXQgKyA4XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gY29weSh0YXJnZXRCdWZmZXIsIHRhcmdldFN0YXJ0PTAsIHNvdXJjZVN0YXJ0PTAsIHNvdXJjZUVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24gY29weSAodGFyZ2V0LCB0YXJnZXRTdGFydCwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0U3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aCkgdGFyZ2V0U3RhcnQgPSB0YXJnZXQubGVuZ3RoXG4gIGlmICghdGFyZ2V0U3RhcnQpIHRhcmdldFN0YXJ0ID0gMFxuICBpZiAoZW5kID4gMCAmJiBlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVybiAwXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgaWYgKHRhcmdldFN0YXJ0IDwgMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgfVxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlRW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIC8vIEFyZSB3ZSBvb2I/XG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCA8IGVuZCAtIHN0YXJ0KSB7XG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0ICsgc3RhcnRcbiAgfVxuXG4gIHZhciBsZW4gPSBlbmQgLSBzdGFydFxuICB2YXIgaVxuXG4gIGlmICh0aGlzID09PSB0YXJnZXQgJiYgc3RhcnQgPCB0YXJnZXRTdGFydCAmJiB0YXJnZXRTdGFydCA8IGVuZCkge1xuICAgIC8vIGRlc2NlbmRpbmcgY29weSBmcm9tIGVuZFxuICAgIGZvciAoaSA9IGxlbiAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICB0YXJnZXRbaSArIHRhcmdldFN0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfSBlbHNlIGlmIChsZW4gPCAxMDAwIHx8ICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIGFzY2VuZGluZyBjb3B5IGZyb20gc3RhcnRcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0U3RhcnQpXG4gIH1cblxuICByZXR1cm4gbGVuXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gZmlsbCAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IHZhbHVlXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciBieXRlcyA9IHV0ZjhUb0J5dGVzKHZhbHVlLnRvU3RyaW5nKCkpXG4gICAgdmFyIGxlbiA9IGJ5dGVzLmxlbmd0aFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSBieXRlc1tpICUgbGVuXVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uIHRvQXJyYXlCdWZmZXIgKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIF9hdWdtZW50IChhcnIpIHtcbiAgYXJyLmNvbnN0cnVjdG9yID0gQnVmZmVyXG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBzZXQgbWV0aG9kIGJlZm9yZSBvdmVyd3JpdGluZ1xuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkXG4gIGFyci5nZXQgPSBCUC5nZXRcbiAgYXJyLnNldCA9IEJQLnNldFxuXG4gIGFyci53cml0ZSA9IEJQLndyaXRlXG4gIGFyci50b1N0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0xvY2FsZVN0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0pTT04gPSBCUC50b0pTT05cbiAgYXJyLmVxdWFscyA9IEJQLmVxdWFsc1xuICBhcnIuY29tcGFyZSA9IEJQLmNvbXBhcmVcbiAgYXJyLmluZGV4T2YgPSBCUC5pbmRleE9mXG4gIGFyci5jb3B5ID0gQlAuY29weVxuICBhcnIuc2xpY2UgPSBCUC5zbGljZVxuICBhcnIucmVhZFVJbnRMRSA9IEJQLnJlYWRVSW50TEVcbiAgYXJyLnJlYWRVSW50QkUgPSBCUC5yZWFkVUludEJFXG4gIGFyci5yZWFkVUludDggPSBCUC5yZWFkVUludDhcbiAgYXJyLnJlYWRVSW50MTZMRSA9IEJQLnJlYWRVSW50MTZMRVxuICBhcnIucmVhZFVJbnQxNkJFID0gQlAucmVhZFVJbnQxNkJFXG4gIGFyci5yZWFkVUludDMyTEUgPSBCUC5yZWFkVUludDMyTEVcbiAgYXJyLnJlYWRVSW50MzJCRSA9IEJQLnJlYWRVSW50MzJCRVxuICBhcnIucmVhZEludExFID0gQlAucmVhZEludExFXG4gIGFyci5yZWFkSW50QkUgPSBCUC5yZWFkSW50QkVcbiAgYXJyLnJlYWRJbnQ4ID0gQlAucmVhZEludDhcbiAgYXJyLnJlYWRJbnQxNkxFID0gQlAucmVhZEludDE2TEVcbiAgYXJyLnJlYWRJbnQxNkJFID0gQlAucmVhZEludDE2QkVcbiAgYXJyLnJlYWRJbnQzMkxFID0gQlAucmVhZEludDMyTEVcbiAgYXJyLnJlYWRJbnQzMkJFID0gQlAucmVhZEludDMyQkVcbiAgYXJyLnJlYWRGbG9hdExFID0gQlAucmVhZEZsb2F0TEVcbiAgYXJyLnJlYWRGbG9hdEJFID0gQlAucmVhZEZsb2F0QkVcbiAgYXJyLnJlYWREb3VibGVMRSA9IEJQLnJlYWREb3VibGVMRVxuICBhcnIucmVhZERvdWJsZUJFID0gQlAucmVhZERvdWJsZUJFXG4gIGFyci53cml0ZVVJbnQ4ID0gQlAud3JpdGVVSW50OFxuICBhcnIud3JpdGVVSW50TEUgPSBCUC53cml0ZVVJbnRMRVxuICBhcnIud3JpdGVVSW50QkUgPSBCUC53cml0ZVVJbnRCRVxuICBhcnIud3JpdGVVSW50MTZMRSA9IEJQLndyaXRlVUludDE2TEVcbiAgYXJyLndyaXRlVUludDE2QkUgPSBCUC53cml0ZVVJbnQxNkJFXG4gIGFyci53cml0ZVVJbnQzMkxFID0gQlAud3JpdGVVSW50MzJMRVxuICBhcnIud3JpdGVVSW50MzJCRSA9IEJQLndyaXRlVUludDMyQkVcbiAgYXJyLndyaXRlSW50TEUgPSBCUC53cml0ZUludExFXG4gIGFyci53cml0ZUludEJFID0gQlAud3JpdGVJbnRCRVxuICBhcnIud3JpdGVJbnQ4ID0gQlAud3JpdGVJbnQ4XG4gIGFyci53cml0ZUludDE2TEUgPSBCUC53cml0ZUludDE2TEVcbiAgYXJyLndyaXRlSW50MTZCRSA9IEJQLndyaXRlSW50MTZCRVxuICBhcnIud3JpdGVJbnQzMkxFID0gQlAud3JpdGVJbnQzMkxFXG4gIGFyci53cml0ZUludDMyQkUgPSBCUC53cml0ZUludDMyQkVcbiAgYXJyLndyaXRlRmxvYXRMRSA9IEJQLndyaXRlRmxvYXRMRVxuICBhcnIud3JpdGVGbG9hdEJFID0gQlAud3JpdGVGbG9hdEJFXG4gIGFyci53cml0ZURvdWJsZUxFID0gQlAud3JpdGVEb3VibGVMRVxuICBhcnIud3JpdGVEb3VibGVCRSA9IEJQLndyaXRlRG91YmxlQkVcbiAgYXJyLmZpbGwgPSBCUC5maWxsXG4gIGFyci5pbnNwZWN0ID0gQlAuaW5zcGVjdFxuICBhcnIudG9BcnJheUJ1ZmZlciA9IEJQLnRvQXJyYXlCdWZmZXJcblxuICByZXR1cm4gYXJyXG59XG5cbnZhciBJTlZBTElEX0JBU0U2NF9SRSA9IC9bXitcXC8wLTlBLVphLXotX10vZ1xuXG5mdW5jdGlvbiBiYXNlNjRjbGVhbiAoc3RyKSB7XG4gIC8vIE5vZGUgc3RyaXBzIG91dCBpbnZhbGlkIGNoYXJhY3RlcnMgbGlrZSBcXG4gYW5kIFxcdCBmcm9tIHRoZSBzdHJpbmcsIGJhc2U2NC1qcyBkb2VzIG5vdFxuICBzdHIgPSBzdHJpbmd0cmltKHN0cikucmVwbGFjZShJTlZBTElEX0JBU0U2NF9SRSwgJycpXG4gIC8vIE5vZGUgY29udmVydHMgc3RyaW5ncyB3aXRoIGxlbmd0aCA8IDIgdG8gJydcbiAgaWYgKHN0ci5sZW5ndGggPCAyKSByZXR1cm4gJydcbiAgLy8gTm9kZSBhbGxvd3MgZm9yIG5vbi1wYWRkZWQgYmFzZTY0IHN0cmluZ3MgKG1pc3NpbmcgdHJhaWxpbmcgPT09KSwgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHdoaWxlIChzdHIubGVuZ3RoICUgNCAhPT0gMCkge1xuICAgIHN0ciA9IHN0ciArICc9J1xuICB9XG4gIHJldHVybiBzdHJcbn1cblxuZnVuY3Rpb24gc3RyaW5ndHJpbSAoc3RyKSB7XG4gIGlmIChzdHIudHJpbSkgcmV0dXJuIHN0ci50cmltKClcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJylcbn1cblxuZnVuY3Rpb24gdG9IZXggKG4pIHtcbiAgaWYgKG4gPCAxNikgcmV0dXJuICcwJyArIG4udG9TdHJpbmcoMTYpXG4gIHJldHVybiBuLnRvU3RyaW5nKDE2KVxufVxuXG5mdW5jdGlvbiB1dGY4VG9CeXRlcyAoc3RyaW5nLCB1bml0cykge1xuICB1bml0cyA9IHVuaXRzIHx8IEluZmluaXR5XG4gIHZhciBjb2RlUG9pbnRcbiAgdmFyIGxlbmd0aCA9IHN0cmluZy5sZW5ndGhcbiAgdmFyIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gIHZhciBieXRlcyA9IFtdXG4gIHZhciBpID0gMFxuXG4gIGZvciAoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBjb2RlUG9pbnQgPSBzdHJpbmcuY2hhckNvZGVBdChpKVxuXG4gICAgLy8gaXMgc3Vycm9nYXRlIGNvbXBvbmVudFxuICAgIGlmIChjb2RlUG9pbnQgPiAweEQ3RkYgJiYgY29kZVBvaW50IDwgMHhFMDAwKSB7XG4gICAgICAvLyBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgICAgLy8gMiBsZWFkcyBpbiBhIHJvd1xuICAgICAgICBpZiAoY29kZVBvaW50IDwgMHhEQzAwKSB7XG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gdmFsaWQgc3Vycm9nYXRlIHBhaXJcbiAgICAgICAgICBjb2RlUG9pbnQgPSBsZWFkU3Vycm9nYXRlIC0gMHhEODAwIDw8IDEwIHwgY29kZVBvaW50IC0gMHhEQzAwIHwgMHgxMDAwMFxuICAgICAgICAgIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIG5vIGxlYWQgeWV0XG5cbiAgICAgICAgaWYgKGNvZGVQb2ludCA+IDB4REJGRikge1xuICAgICAgICAgIC8vIHVuZXhwZWN0ZWQgdHJhaWxcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2UgaWYgKGkgKyAxID09PSBsZW5ndGgpIHtcbiAgICAgICAgICAvLyB1bnBhaXJlZCBsZWFkXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB2YWxpZCBsZWFkXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgIC8vIHZhbGlkIGJtcCBjaGFyLCBidXQgbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICB9XG5cbiAgICAvLyBlbmNvZGUgdXRmOFxuICAgIGlmIChjb2RlUG9pbnQgPCAweDgwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDEpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goY29kZVBvaW50KVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHg4MDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiB8IDB4QzAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDEwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDMpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgfCAweEUwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDIwMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSA0KSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHgxMiB8IDB4RjAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgY29kZSBwb2ludCcpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbmZ1bmN0aW9uIGFzY2lpVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIC8vIE5vZGUncyBjb2RlIHNlZW1zIHRvIGJlIGRvaW5nIHRoaXMgYW5kIG5vdCAmIDB4N0YuLlxuICAgIGJ5dGVBcnJheS5wdXNoKHN0ci5jaGFyQ29kZUF0KGkpICYgMHhGRilcbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVUb0J5dGVzIChzdHIsIHVuaXRzKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG5cbiAgICBjID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBoaSA9IGMgPj4gOFxuICAgIGxvID0gYyAlIDI1NlxuICAgIGJ5dGVBcnJheS5wdXNoKGxvKVxuICAgIGJ5dGVBcnJheS5wdXNoKGhpKVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBiYXNlNjRUb0J5dGVzIChzdHIpIHtcbiAgcmV0dXJuIGJhc2U2NC50b0J5dGVBcnJheShiYXNlNjRjbGVhbihzdHIpKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSkgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiBkZWNvZGVVdGY4Q2hhciAoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzdHIpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4RkZGRCkgLy8gVVRGIDggaW52YWxpZCBjaGFyXG4gIH1cbn1cbiJdfQ==
},{"_process":5,"base64-js":2,"buffer":1,"ieee754":3,"is-array":4}],2:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-coffeeify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib/b64.js","/../node_modules/gulp-coffeeify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9iYXNlNjQtanMvbGliL2I2NC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iXX0=
},{"_process":5,"buffer":1}],3:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-coffeeify/node_modules/browserify/node_modules/buffer/node_modules/ieee754/index.js","/../node_modules/gulp-coffeeify/node_modules/browserify/node_modules/buffer/node_modules/ieee754")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0cy5yZWFkID0gZnVuY3Rpb24gKGJ1ZmZlciwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG1cbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBuQml0cyA9IC03XG4gIHZhciBpID0gaXNMRSA/IChuQnl0ZXMgLSAxKSA6IDBcbiAgdmFyIGQgPSBpc0xFID8gLTEgOiAxXG4gIHZhciBzID0gYnVmZmVyW29mZnNldCArIGldXG5cbiAgaSArPSBkXG5cbiAgZSA9IHMgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgcyA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gZUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBlID0gZSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIG0gPSBlICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIGUgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IG1MZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgbSA9IG0gKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBpZiAoZSA9PT0gMCkge1xuICAgIGUgPSAxIC0gZUJpYXNcbiAgfSBlbHNlIGlmIChlID09PSBlTWF4KSB7XG4gICAgcmV0dXJuIG0gPyBOYU4gOiAoKHMgPyAtMSA6IDEpICogSW5maW5pdHkpXG4gIH0gZWxzZSB7XG4gICAgbSA9IG0gKyBNYXRoLnBvdygyLCBtTGVuKVxuICAgIGUgPSBlIC0gZUJpYXNcbiAgfVxuICByZXR1cm4gKHMgPyAtMSA6IDEpICogbSAqIE1hdGgucG93KDIsIGUgLSBtTGVuKVxufVxuXG5leHBvcnRzLndyaXRlID0gZnVuY3Rpb24gKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLCBjXG4gIHZhciBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxXG4gIHZhciBlTWF4ID0gKDEgPDwgZUxlbikgLSAxXG4gIHZhciBlQmlhcyA9IGVNYXggPj4gMVxuICB2YXIgcnQgPSAobUxlbiA9PT0gMjMgPyBNYXRoLnBvdygyLCAtMjQpIC0gTWF0aC5wb3coMiwgLTc3KSA6IDApXG4gIHZhciBpID0gaXNMRSA/IDAgOiAobkJ5dGVzIC0gMSlcbiAgdmFyIGQgPSBpc0xFID8gMSA6IC0xXG4gIHZhciBzID0gdmFsdWUgPCAwIHx8ICh2YWx1ZSA9PT0gMCAmJiAxIC8gdmFsdWUgPCAwKSA/IDEgOiAwXG5cbiAgdmFsdWUgPSBNYXRoLmFicyh2YWx1ZSlcblxuICBpZiAoaXNOYU4odmFsdWUpIHx8IHZhbHVlID09PSBJbmZpbml0eSkge1xuICAgIG0gPSBpc05hTih2YWx1ZSkgPyAxIDogMFxuICAgIGUgPSBlTWF4XG4gIH0gZWxzZSB7XG4gICAgZSA9IE1hdGguZmxvb3IoTWF0aC5sb2codmFsdWUpIC8gTWF0aC5MTjIpXG4gICAgaWYgKHZhbHVlICogKGMgPSBNYXRoLnBvdygyLCAtZSkpIDwgMSkge1xuICAgICAgZS0tXG4gICAgICBjICo9IDJcbiAgICB9XG4gICAgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICB2YWx1ZSArPSBydCAvIGNcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgKz0gcnQgKiBNYXRoLnBvdygyLCAxIC0gZUJpYXMpXG4gICAgfVxuICAgIGlmICh2YWx1ZSAqIGMgPj0gMikge1xuICAgICAgZSsrXG4gICAgICBjIC89IDJcbiAgICB9XG5cbiAgICBpZiAoZSArIGVCaWFzID49IGVNYXgpIHtcbiAgICAgIG0gPSAwXG4gICAgICBlID0gZU1heFxuICAgIH0gZWxzZSBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIG0gPSAodmFsdWUgKiBjIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IGUgKyBlQmlhc1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gdmFsdWUgKiBNYXRoLnBvdygyLCBlQmlhcyAtIDEpICogTWF0aC5wb3coMiwgbUxlbilcbiAgICAgIGUgPSAwXG4gICAgfVxuICB9XG5cbiAgZm9yICg7IG1MZW4gPj0gODsgYnVmZmVyW29mZnNldCArIGldID0gbSAmIDB4ZmYsIGkgKz0gZCwgbSAvPSAyNTYsIG1MZW4gLT0gOCkge31cblxuICBlID0gKGUgPDwgbUxlbikgfCBtXG4gIGVMZW4gKz0gbUxlblxuICBmb3IgKDsgZUxlbiA+IDA7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IGUgJiAweGZmLCBpICs9IGQsIGUgLz0gMjU2LCBlTGVuIC09IDgpIHt9XG5cbiAgYnVmZmVyW29mZnNldCArIGkgLSBkXSB8PSBzICogMTI4XG59XG4iXX0=
},{"_process":5,"buffer":1}],4:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-coffeeify/node_modules/browserify/node_modules/buffer/node_modules/is-array/index.js","/../node_modules/gulp-coffeeify/node_modules/browserify/node_modules/buffer/node_modules/is-array")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheS9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIl19
},{"_process":5,"buffer":1}],5:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;

function drainQueue() {
    if (draining) {
        return;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        var i = -1;
        while (++i < len) {
            currentQueue[i]();
        }
        len = queue.length;
    }
    draining = false;
}
process.nextTick = function (fun) {
    queue.push(fun);
    if (!draining) {
        setTimeout(drainQueue, 0);
    }
};

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-coffeeify/node_modules/browserify/node_modules/process/browser.js","/../node_modules/gulp-coffeeify/node_modules/browserify/node_modules/process")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcblxudmFyIHByb2Nlc3MgPSBtb2R1bGUuZXhwb3J0cyA9IHt9O1xudmFyIHF1ZXVlID0gW107XG52YXIgZHJhaW5pbmcgPSBmYWxzZTtcblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBkcmFpbmluZyA9IHRydWU7XG4gICAgdmFyIGN1cnJlbnRRdWV1ZTtcbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgdmFyIGkgPSAtMTtcbiAgICAgICAgd2hpbGUgKCsraSA8IGxlbikge1xuICAgICAgICAgICAgY3VycmVudFF1ZXVlW2ldKCk7XG4gICAgICAgIH1cbiAgICAgICAgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBkcmFpbmluZyA9IGZhbHNlO1xufVxucHJvY2Vzcy5uZXh0VGljayA9IGZ1bmN0aW9uIChmdW4pIHtcbiAgICBxdWV1ZS5wdXNoKGZ1bik7XG4gICAgaWYgKCFkcmFpbmluZykge1xuICAgICAgICBzZXRUaW1lb3V0KGRyYWluUXVldWUsIDApO1xuICAgIH1cbn07XG5cbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xucHJvY2Vzcy52ZXJzaW9uID0gJyc7IC8vIGVtcHR5IHN0cmluZyB0byBhdm9pZCByZWdleHAgaXNzdWVzXG5wcm9jZXNzLnZlcnNpb25zID0ge307XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG4vLyBUT0RPKHNodHlsbWFuKVxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5wcm9jZXNzLnVtYXNrID0gZnVuY3Rpb24oKSB7IHJldHVybiAwOyB9O1xuIl19
},{"_process":5,"buffer":1}],6:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/**
 * Module constructor
 * @param  {Object} target Target object to extends methods and properties into
 * @return {Object}        Target after with extended methods and properties
 */
module.exports = function(target) {
  target = target || {};
  for(var prop in Happens)
    target[prop] = Happens[prop];
  return target;
};



/**
 * Class Happens
 * @type {Object}
 */
var Happens = {

  /**
   * Initializes event
   * @param  {String} event Event name to initialize
   * @return {Array}        Initialized event pool
   */
  __init: function(event) {
    var tmp = this.__listeners || (this.__listeners = []);
    return tmp[event] || (tmp[event] = []);
  },

  /**
   * Adds listener
   * @param  {String}   event Event name
   * @param  {Function} fn    Event handler
   */
  on: function(event, fn) {
    validate(fn);
    this.__init(event).push(fn);
  },

  /**
   * Removes listener
   * @param  {String}   event Event name
   * @param  {Function} fn    Event handler
   */
  off: function(event, fn) {
    var pool = this.__init(event);
    pool.splice(pool.indexOf(fn), 1);
  },

  /**
   * Add listener the fires once and auto-removes itself
   * @param  {String}   event Event name
   * @param  {Function} fn    Event handler
   */
  once: function(event, fn) {
    validate(fn);
    var self = this, wrapper = function() {
      self.off(event, wrapper);
      fn.apply(this, arguments);
    };
    this.on(event, wrapper );
  },

  /**
   * Emit some event
   * @param  {String} event Event name -- subsequent params after `event` will
   * be passed along to the event's handlers
   */
  emit: function(event /*, arg1, arg2 */ ) {
    var i, pool = this.__init(event).slice(0);
    for(i in pool)
      pool[i].apply(this, [].slice.call(arguments, 1));
  }
};



/**
 * Validates if a function exists and is an instanceof Function, and throws
 * an error if needed
 * @param  {Function} fn Function to validate
 */
function validate(fn) {
  if(!(fn && fn instanceof Function))
    throw new Error(fn + ' is not a Function');
}
}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/happens/index.js","/../node_modules/happens")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL25vZGVfbW9kdWxlcy9oYXBwZW5zL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTW9kdWxlIGNvbnN0cnVjdG9yXG4gKiBAcGFyYW0gIHtPYmplY3R9IHRhcmdldCBUYXJnZXQgb2JqZWN0IHRvIGV4dGVuZHMgbWV0aG9kcyBhbmQgcHJvcGVydGllcyBpbnRvXG4gKiBAcmV0dXJuIHtPYmplY3R9ICAgICAgICBUYXJnZXQgYWZ0ZXIgd2l0aCBleHRlbmRlZCBtZXRob2RzIGFuZCBwcm9wZXJ0aWVzXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIHRhcmdldCA9IHRhcmdldCB8fCB7fTtcbiAgZm9yKHZhciBwcm9wIGluIEhhcHBlbnMpXG4gICAgdGFyZ2V0W3Byb3BdID0gSGFwcGVuc1twcm9wXTtcbiAgcmV0dXJuIHRhcmdldDtcbn07XG5cblxuXG4vKipcbiAqIENsYXNzIEhhcHBlbnNcbiAqIEB0eXBlIHtPYmplY3R9XG4gKi9cbnZhciBIYXBwZW5zID0ge1xuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplcyBldmVudFxuICAgKiBAcGFyYW0gIHtTdHJpbmd9IGV2ZW50IEV2ZW50IG5hbWUgdG8gaW5pdGlhbGl6ZVxuICAgKiBAcmV0dXJuIHtBcnJheX0gICAgICAgIEluaXRpYWxpemVkIGV2ZW50IHBvb2xcbiAgICovXG4gIF9faW5pdDogZnVuY3Rpb24oZXZlbnQpIHtcbiAgICB2YXIgdG1wID0gdGhpcy5fX2xpc3RlbmVycyB8fCAodGhpcy5fX2xpc3RlbmVycyA9IFtdKTtcbiAgICByZXR1cm4gdG1wW2V2ZW50XSB8fCAodG1wW2V2ZW50XSA9IFtdKTtcbiAgfSxcblxuICAvKipcbiAgICogQWRkcyBsaXN0ZW5lclxuICAgKiBAcGFyYW0gIHtTdHJpbmd9ICAgZXZlbnQgRXZlbnQgbmFtZVxuICAgKiBAcGFyYW0gIHtGdW5jdGlvbn0gZm4gICAgRXZlbnQgaGFuZGxlclxuICAgKi9cbiAgb246IGZ1bmN0aW9uKGV2ZW50LCBmbikge1xuICAgIHZhbGlkYXRlKGZuKTtcbiAgICB0aGlzLl9faW5pdChldmVudCkucHVzaChmbik7XG4gIH0sXG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgbGlzdGVuZXJcbiAgICogQHBhcmFtICB7U3RyaW5nfSAgIGV2ZW50IEV2ZW50IG5hbWVcbiAgICogQHBhcmFtICB7RnVuY3Rpb259IGZuICAgIEV2ZW50IGhhbmRsZXJcbiAgICovXG4gIG9mZjogZnVuY3Rpb24oZXZlbnQsIGZuKSB7XG4gICAgdmFyIHBvb2wgPSB0aGlzLl9faW5pdChldmVudCk7XG4gICAgcG9vbC5zcGxpY2UocG9vbC5pbmRleE9mKGZuKSwgMSk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEFkZCBsaXN0ZW5lciB0aGUgZmlyZXMgb25jZSBhbmQgYXV0by1yZW1vdmVzIGl0c2VsZlxuICAgKiBAcGFyYW0gIHtTdHJpbmd9ICAgZXZlbnQgRXZlbnQgbmFtZVxuICAgKiBAcGFyYW0gIHtGdW5jdGlvbn0gZm4gICAgRXZlbnQgaGFuZGxlclxuICAgKi9cbiAgb25jZTogZnVuY3Rpb24oZXZlbnQsIGZuKSB7XG4gICAgdmFsaWRhdGUoZm4pO1xuICAgIHZhciBzZWxmID0gdGhpcywgd3JhcHBlciA9IGZ1bmN0aW9uKCkge1xuICAgICAgc2VsZi5vZmYoZXZlbnQsIHdyYXBwZXIpO1xuICAgICAgZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICAgIHRoaXMub24oZXZlbnQsIHdyYXBwZXIgKTtcbiAgfSxcblxuICAvKipcbiAgICogRW1pdCBzb21lIGV2ZW50XG4gICAqIEBwYXJhbSAge1N0cmluZ30gZXZlbnQgRXZlbnQgbmFtZSAtLSBzdWJzZXF1ZW50IHBhcmFtcyBhZnRlciBgZXZlbnRgIHdpbGxcbiAgICogYmUgcGFzc2VkIGFsb25nIHRvIHRoZSBldmVudCdzIGhhbmRsZXJzXG4gICAqL1xuICBlbWl0OiBmdW5jdGlvbihldmVudCAvKiwgYXJnMSwgYXJnMiAqLyApIHtcbiAgICB2YXIgaSwgcG9vbCA9IHRoaXMuX19pbml0KGV2ZW50KS5zbGljZSgwKTtcbiAgICBmb3IoaSBpbiBwb29sKVxuICAgICAgcG9vbFtpXS5hcHBseSh0aGlzLCBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSkpO1xuICB9XG59O1xuXG5cblxuLyoqXG4gKiBWYWxpZGF0ZXMgaWYgYSBmdW5jdGlvbiBleGlzdHMgYW5kIGlzIGFuIGluc3RhbmNlb2YgRnVuY3Rpb24sIGFuZCB0aHJvd3NcbiAqIGFuIGVycm9yIGlmIG5lZWRlZFxuICogQHBhcmFtICB7RnVuY3Rpb259IGZuIEZ1bmN0aW9uIHRvIHZhbGlkYXRlXG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlKGZuKSB7XG4gIGlmKCEoZm4gJiYgZm4gaW5zdGFuY2VvZiBGdW5jdGlvbikpXG4gICAgdGhyb3cgbmV3IEVycm9yKGZuICsgJyBpcyBub3QgYSBGdW5jdGlvbicpO1xufSJdfQ==
},{"_process":5,"buffer":1}],7:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var Loader, SequenceLoader, c, happens,
  bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

happens = require('happens');

Loader = require('./loading/sync_loader');

c = require('./log');

module.exports = SequenceLoader = (function() {
  SequenceLoader.prototype.path = '';

  SequenceLoader.prototype.packs_count = 0;

  SequenceLoader.prototype.packs_total = 0;

  SequenceLoader.prototype.percent_loaded = 0;

  function SequenceLoader(file) {
    this.packs_loaded = bind(this.packs_loaded, this);
    this.data_loaded = bind(this.data_loaded, this);
    happens(this);
    this.loader = new Loader;
    this.loader.once('loaded', this.data_loaded);
  }

  SequenceLoader.prototype.load = function(file) {
    this.path = file.split('/');
    this.path.pop();
    this.path = this.path.join('/');
    this.loader.add('data', file, 'json');
    return this.loader.load();
  };

  SequenceLoader.prototype.data_loaded = function() {
    this.data = (this.loader.get_asset('data')).data;
    this.packs_total = this.data.total_packs;
    this.emit('data:loaded');
    this.loader.on('loaded', this.packs_loaded);
    return this._load();
  };

  SequenceLoader.prototype._load = function() {
    this.loader.add(this.packs_count + ".pack", this.path + "/" + this.packs_count + ".pack", 'binary');
    return this.loader.load();
  };

  SequenceLoader.prototype.dispose = function() {
    this.loader.off('loaded', this.packs_loaded);
    this.loader.dispose();
    delete this.loader;
    return this.data = null;
  };

  SequenceLoader.prototype.packs_loaded = function() {
    var blob, config, file_name, i, image, images, j, len, mp, pack_id, ref;
    images = [];
    pack_id = this.packs_count + ".pack";
    blob = (this.loader.get_asset(this.packs_count + ".pack")).data;
    config = this.data['frames'][this.packs_count];
    mp = new Magipack(blob, config);
    len = config.length;
    for (i = j = 0, ref = len; 0 <= ref ? j < ref : j > ref; i = 0 <= ref ? ++j : --j) {
      file_name = config[i][0];
      image = new Image();
      image.src = mp.getURI(file_name);
      images.push(image);
    }
    this.emit('buffer:update', images);
    this.packs_count++;
    this.percent_loaded = this.packs_count / this.packs_total;
    c.debug("Loaded " + this.packs_count + " / " + this.data.total_packs);
    if (this.packs_count >= this.packs_total) {
      return this.emit('buffer:complete');
    } else {
      return this._load();
    }
  };

  return SequenceLoader;

})();

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/loader.coffee","/")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxvYWRlci5jb2ZmZWUiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbInZhciBMb2FkZXIsIFNlcXVlbmNlTG9hZGVyLCBjLCBoYXBwZW5zLFxuICBiaW5kID0gZnVuY3Rpb24oZm4sIG1lKXsgcmV0dXJuIGZ1bmN0aW9uKCl7IHJldHVybiBmbi5hcHBseShtZSwgYXJndW1lbnRzKTsgfTsgfTtcblxuaGFwcGVucyA9IHJlcXVpcmUoJ2hhcHBlbnMnKTtcblxuTG9hZGVyID0gcmVxdWlyZSgnLi9sb2FkaW5nL3N5bmNfbG9hZGVyJyk7XG5cbmMgPSByZXF1aXJlKCcuL2xvZycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNlcXVlbmNlTG9hZGVyID0gKGZ1bmN0aW9uKCkge1xuICBTZXF1ZW5jZUxvYWRlci5wcm90b3R5cGUucGF0aCA9ICcnO1xuXG4gIFNlcXVlbmNlTG9hZGVyLnByb3RvdHlwZS5wYWNrc19jb3VudCA9IDA7XG5cbiAgU2VxdWVuY2VMb2FkZXIucHJvdG90eXBlLnBhY2tzX3RvdGFsID0gMDtcblxuICBTZXF1ZW5jZUxvYWRlci5wcm90b3R5cGUucGVyY2VudF9sb2FkZWQgPSAwO1xuXG4gIGZ1bmN0aW9uIFNlcXVlbmNlTG9hZGVyKGZpbGUpIHtcbiAgICB0aGlzLnBhY2tzX2xvYWRlZCA9IGJpbmQodGhpcy5wYWNrc19sb2FkZWQsIHRoaXMpO1xuICAgIHRoaXMuZGF0YV9sb2FkZWQgPSBiaW5kKHRoaXMuZGF0YV9sb2FkZWQsIHRoaXMpO1xuICAgIGhhcHBlbnModGhpcyk7XG4gICAgdGhpcy5sb2FkZXIgPSBuZXcgTG9hZGVyO1xuICAgIHRoaXMubG9hZGVyLm9uY2UoJ2xvYWRlZCcsIHRoaXMuZGF0YV9sb2FkZWQpO1xuICB9XG5cbiAgU2VxdWVuY2VMb2FkZXIucHJvdG90eXBlLmxvYWQgPSBmdW5jdGlvbihmaWxlKSB7XG4gICAgdGhpcy5wYXRoID0gZmlsZS5zcGxpdCgnLycpO1xuICAgIHRoaXMucGF0aC5wb3AoKTtcbiAgICB0aGlzLnBhdGggPSB0aGlzLnBhdGguam9pbignLycpO1xuICAgIHRoaXMubG9hZGVyLmFkZCgnZGF0YScsIGZpbGUsICdqc29uJyk7XG4gICAgcmV0dXJuIHRoaXMubG9hZGVyLmxvYWQoKTtcbiAgfTtcblxuICBTZXF1ZW5jZUxvYWRlci5wcm90b3R5cGUuZGF0YV9sb2FkZWQgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmRhdGEgPSAodGhpcy5sb2FkZXIuZ2V0X2Fzc2V0KCdkYXRhJykpLmRhdGE7XG4gICAgdGhpcy5wYWNrc190b3RhbCA9IHRoaXMuZGF0YS50b3RhbF9wYWNrcztcbiAgICB0aGlzLmVtaXQoJ2RhdGE6bG9hZGVkJyk7XG4gICAgdGhpcy5sb2FkZXIub24oJ2xvYWRlZCcsIHRoaXMucGFja3NfbG9hZGVkKTtcbiAgICByZXR1cm4gdGhpcy5fbG9hZCgpO1xuICB9O1xuXG4gIFNlcXVlbmNlTG9hZGVyLnByb3RvdHlwZS5fbG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubG9hZGVyLmFkZCh0aGlzLnBhY2tzX2NvdW50ICsgXCIucGFja1wiLCB0aGlzLnBhdGggKyBcIi9cIiArIHRoaXMucGFja3NfY291bnQgKyBcIi5wYWNrXCIsICdiaW5hcnknKTtcbiAgICByZXR1cm4gdGhpcy5sb2FkZXIubG9hZCgpO1xuICB9O1xuXG4gIFNlcXVlbmNlTG9hZGVyLnByb3RvdHlwZS5kaXNwb3NlID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5sb2FkZXIub2ZmKCdsb2FkZWQnLCB0aGlzLnBhY2tzX2xvYWRlZCk7XG4gICAgdGhpcy5sb2FkZXIuZGlzcG9zZSgpO1xuICAgIGRlbGV0ZSB0aGlzLmxvYWRlcjtcbiAgICByZXR1cm4gdGhpcy5kYXRhID0gbnVsbDtcbiAgfTtcblxuICBTZXF1ZW5jZUxvYWRlci5wcm90b3R5cGUucGFja3NfbG9hZGVkID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGJsb2IsIGNvbmZpZywgZmlsZV9uYW1lLCBpLCBpbWFnZSwgaW1hZ2VzLCBqLCBsZW4sIG1wLCBwYWNrX2lkLCByZWY7XG4gICAgaW1hZ2VzID0gW107XG4gICAgcGFja19pZCA9IHRoaXMucGFja3NfY291bnQgKyBcIi5wYWNrXCI7XG4gICAgYmxvYiA9ICh0aGlzLmxvYWRlci5nZXRfYXNzZXQodGhpcy5wYWNrc19jb3VudCArIFwiLnBhY2tcIikpLmRhdGE7XG4gICAgY29uZmlnID0gdGhpcy5kYXRhWydmcmFtZXMnXVt0aGlzLnBhY2tzX2NvdW50XTtcbiAgICBtcCA9IG5ldyBNYWdpcGFjayhibG9iLCBjb25maWcpO1xuICAgIGxlbiA9IGNvbmZpZy5sZW5ndGg7XG4gICAgZm9yIChpID0gaiA9IDAsIHJlZiA9IGxlbjsgMCA8PSByZWYgPyBqIDwgcmVmIDogaiA+IHJlZjsgaSA9IDAgPD0gcmVmID8gKytqIDogLS1qKSB7XG4gICAgICBmaWxlX25hbWUgPSBjb25maWdbaV1bMF07XG4gICAgICBpbWFnZSA9IG5ldyBJbWFnZSgpO1xuICAgICAgaW1hZ2Uuc3JjID0gbXAuZ2V0VVJJKGZpbGVfbmFtZSk7XG4gICAgICBpbWFnZXMucHVzaChpbWFnZSk7XG4gICAgfVxuICAgIHRoaXMuZW1pdCgnYnVmZmVyOnVwZGF0ZScsIGltYWdlcyk7XG4gICAgdGhpcy5wYWNrc19jb3VudCsrO1xuICAgIHRoaXMucGVyY2VudF9sb2FkZWQgPSB0aGlzLnBhY2tzX2NvdW50IC8gdGhpcy5wYWNrc190b3RhbDtcbiAgICBjLmRlYnVnKFwiTG9hZGVkIFwiICsgdGhpcy5wYWNrc19jb3VudCArIFwiIC8gXCIgKyB0aGlzLmRhdGEudG90YWxfcGFja3MpO1xuICAgIGlmICh0aGlzLnBhY2tzX2NvdW50ID49IHRoaXMucGFja3NfdG90YWwpIHtcbiAgICAgIHJldHVybiB0aGlzLmVtaXQoJ2J1ZmZlcjpjb21wbGV0ZScpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdGhpcy5fbG9hZCgpO1xuICAgIH1cbiAgfTtcblxuICByZXR1cm4gU2VxdWVuY2VMb2FkZXI7XG5cbn0pKCk7XG4iXX0=
},{"./loading/sync_loader":11,"./log":12,"_process":5,"buffer":1,"happens":6}],8:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var AsyncLoader, BinaryLoader, DataLoader, happens,
  bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

happens = require('happens');

DataLoader = require('./data_loader');

BinaryLoader = require('./binary_loader');


/*
Load files asynchronously
 */

module.exports = AsyncLoader = (function() {
  function AsyncLoader() {
    this.error = bind(this.error, this);
    this.success = bind(this.success, this);
    happens(this);
    this.manifest = [];
  }

  AsyncLoader.prototype.add = function(id, file, type, data) {
    var obj;
    obj = {
      id: id,
      src: file,
      type: type,
      data: data
    };
    return this.manifest.push(obj);
  };

  AsyncLoader.prototype.load = function() {
    var asset, i, l, len, ref, results;
    this.count = 0;
    this.total = this.manifest.length;
    this.date = new Date();
    ref = this.manifest;
    results = [];
    for (i = 0, len = ref.length; i < len; i++) {
      asset = ref[i];
      switch (asset.type) {
        case 'json':
        case 'xml':
          l = new DataLoader;
          l.once('loaded', this.success);
          results.push(l.load(asset));
          break;
        case 'binary':
          l = new BinaryLoader;
          l.once('loaded', this.success);
          results.push(l.load(asset));
          break;
        default:
          results.push(void 0);
      }
    }
    return results;
  };

  AsyncLoader.prototype.success = function(asset) {
    this.count++;
    if (this.count >= this.total) {
      c.debug('Loaded in', (new Date() - this.date) / 1000);
      return this.emit('loaded', this.manifest);
    }
  };

  AsyncLoader.prototype.error = function(error) {
    return c.log('error', error);
  };

  AsyncLoader.prototype.get_asset = function(id) {
    var asset, i, len, ref, result;
    result = false;
    ref = this.manifest;
    for (i = 0, len = ref.length; i < len; i++) {
      asset = ref[i];
      if (asset.id.match(id)) {
        result = asset;
      }
    }
    return result;
  };

  AsyncLoader.prototype.dispose = function() {
    return this.manifest = [];
  };

  return AsyncLoader;

})();

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/loading/async_loader.coffee","/loading")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxvYWRpbmcvYXN5bmNfbG9hZGVyLmNvZmZlZSJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbInZhciBBc3luY0xvYWRlciwgQmluYXJ5TG9hZGVyLCBEYXRhTG9hZGVyLCBoYXBwZW5zLFxuICBiaW5kID0gZnVuY3Rpb24oZm4sIG1lKXsgcmV0dXJuIGZ1bmN0aW9uKCl7IHJldHVybiBmbi5hcHBseShtZSwgYXJndW1lbnRzKTsgfTsgfTtcblxuaGFwcGVucyA9IHJlcXVpcmUoJ2hhcHBlbnMnKTtcblxuRGF0YUxvYWRlciA9IHJlcXVpcmUoJy4vZGF0YV9sb2FkZXInKTtcblxuQmluYXJ5TG9hZGVyID0gcmVxdWlyZSgnLi9iaW5hcnlfbG9hZGVyJyk7XG5cblxuLypcbkxvYWQgZmlsZXMgYXN5bmNocm9ub3VzbHlcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IEFzeW5jTG9hZGVyID0gKGZ1bmN0aW9uKCkge1xuICBmdW5jdGlvbiBBc3luY0xvYWRlcigpIHtcbiAgICB0aGlzLmVycm9yID0gYmluZCh0aGlzLmVycm9yLCB0aGlzKTtcbiAgICB0aGlzLnN1Y2Nlc3MgPSBiaW5kKHRoaXMuc3VjY2VzcywgdGhpcyk7XG4gICAgaGFwcGVucyh0aGlzKTtcbiAgICB0aGlzLm1hbmlmZXN0ID0gW107XG4gIH1cblxuICBBc3luY0xvYWRlci5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oaWQsIGZpbGUsIHR5cGUsIGRhdGEpIHtcbiAgICB2YXIgb2JqO1xuICAgIG9iaiA9IHtcbiAgICAgIGlkOiBpZCxcbiAgICAgIHNyYzogZmlsZSxcbiAgICAgIHR5cGU6IHR5cGUsXG4gICAgICBkYXRhOiBkYXRhXG4gICAgfTtcbiAgICByZXR1cm4gdGhpcy5tYW5pZmVzdC5wdXNoKG9iaik7XG4gIH07XG5cbiAgQXN5bmNMb2FkZXIucHJvdG90eXBlLmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXNzZXQsIGksIGwsIGxlbiwgcmVmLCByZXN1bHRzO1xuICAgIHRoaXMuY291bnQgPSAwO1xuICAgIHRoaXMudG90YWwgPSB0aGlzLm1hbmlmZXN0Lmxlbmd0aDtcbiAgICB0aGlzLmRhdGUgPSBuZXcgRGF0ZSgpO1xuICAgIHJlZiA9IHRoaXMubWFuaWZlc3Q7XG4gICAgcmVzdWx0cyA9IFtdO1xuICAgIGZvciAoaSA9IDAsIGxlbiA9IHJlZi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgYXNzZXQgPSByZWZbaV07XG4gICAgICBzd2l0Y2ggKGFzc2V0LnR5cGUpIHtcbiAgICAgICAgY2FzZSAnanNvbic6XG4gICAgICAgIGNhc2UgJ3htbCc6XG4gICAgICAgICAgbCA9IG5ldyBEYXRhTG9hZGVyO1xuICAgICAgICAgIGwub25jZSgnbG9hZGVkJywgdGhpcy5zdWNjZXNzKTtcbiAgICAgICAgICByZXN1bHRzLnB1c2gobC5sb2FkKGFzc2V0KSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgICAgbCA9IG5ldyBCaW5hcnlMb2FkZXI7XG4gICAgICAgICAgbC5vbmNlKCdsb2FkZWQnLCB0aGlzLnN1Y2Nlc3MpO1xuICAgICAgICAgIHJlc3VsdHMucHVzaChsLmxvYWQoYXNzZXQpKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICByZXN1bHRzLnB1c2godm9pZCAwKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdHM7XG4gIH07XG5cbiAgQXN5bmNMb2FkZXIucHJvdG90eXBlLnN1Y2Nlc3MgPSBmdW5jdGlvbihhc3NldCkge1xuICAgIHRoaXMuY291bnQrKztcbiAgICBpZiAodGhpcy5jb3VudCA+PSB0aGlzLnRvdGFsKSB7XG4gICAgICBjLmRlYnVnKCdMb2FkZWQgaW4nLCAobmV3IERhdGUoKSAtIHRoaXMuZGF0ZSkgLyAxMDAwKTtcbiAgICAgIHJldHVybiB0aGlzLmVtaXQoJ2xvYWRlZCcsIHRoaXMubWFuaWZlc3QpO1xuICAgIH1cbiAgfTtcblxuICBBc3luY0xvYWRlci5wcm90b3R5cGUuZXJyb3IgPSBmdW5jdGlvbihlcnJvcikge1xuICAgIHJldHVybiBjLmxvZygnZXJyb3InLCBlcnJvcik7XG4gIH07XG5cbiAgQXN5bmNMb2FkZXIucHJvdG90eXBlLmdldF9hc3NldCA9IGZ1bmN0aW9uKGlkKSB7XG4gICAgdmFyIGFzc2V0LCBpLCBsZW4sIHJlZiwgcmVzdWx0O1xuICAgIHJlc3VsdCA9IGZhbHNlO1xuICAgIHJlZiA9IHRoaXMubWFuaWZlc3Q7XG4gICAgZm9yIChpID0gMCwgbGVuID0gcmVmLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICBhc3NldCA9IHJlZltpXTtcbiAgICAgIGlmIChhc3NldC5pZC5tYXRjaChpZCkpIHtcbiAgICAgICAgcmVzdWx0ID0gYXNzZXQ7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgQXN5bmNMb2FkZXIucHJvdG90eXBlLmRpc3Bvc2UgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5tYW5pZmVzdCA9IFtdO1xuICB9O1xuXG4gIHJldHVybiBBc3luY0xvYWRlcjtcblxufSkoKTtcbiJdfQ==
},{"./binary_loader":9,"./data_loader":10,"_process":5,"buffer":1,"happens":6}],9:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var BinaryLoader, happens;

happens = require('happens');

module.exports = BinaryLoader = (function() {
  function BinaryLoader() {
    happens(this);
  }

  BinaryLoader.prototype.load = function(asset) {
    var type, xhr;
    xhr = this.req();
    if (!type) {
      type = "arraybuffer";
      try {
        if (Blob.prototype.slice) {
          type = "blob";
        }
      } catch (_error) {}
    }
    xhr.open("GET", asset.src, true);
    xhr.responseType = type;
    xhr.onprogress = function(e) {};
    xhr.onerror = function() {
      return this.emit('error', xhr.status);
    };
    xhr.onreadystatechange = (function(_this) {
      return function(e) {
        if (xhr.readyState === 4) {
          asset.data = xhr.response;
          _this.emit('loaded', asset);
          xhr.onreadystatechange = null;
        }
      };
    })(this);
    return xhr.send(null);
  };

  BinaryLoader.prototype.req = function() {
    if (window.XMLHttpRequest) {
      return new XMLHttpRequest();
    }
    if (window.ActiveXObject) {
      return new ActiveXObject("MSXML2.XMLHTTP.3.0");
    }
  };

  return BinaryLoader;

})();

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/loading/binary_loader.coffee","/loading")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxvYWRpbmcvYmluYXJ5X2xvYWRlci5jb2ZmZWUiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsidmFyIEJpbmFyeUxvYWRlciwgaGFwcGVucztcblxuaGFwcGVucyA9IHJlcXVpcmUoJ2hhcHBlbnMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBCaW5hcnlMb2FkZXIgPSAoZnVuY3Rpb24oKSB7XG4gIGZ1bmN0aW9uIEJpbmFyeUxvYWRlcigpIHtcbiAgICBoYXBwZW5zKHRoaXMpO1xuICB9XG5cbiAgQmluYXJ5TG9hZGVyLnByb3RvdHlwZS5sb2FkID0gZnVuY3Rpb24oYXNzZXQpIHtcbiAgICB2YXIgdHlwZSwgeGhyO1xuICAgIHhociA9IHRoaXMucmVxKCk7XG4gICAgaWYgKCF0eXBlKSB7XG4gICAgICB0eXBlID0gXCJhcnJheWJ1ZmZlclwiO1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKEJsb2IucHJvdG90eXBlLnNsaWNlKSB7XG4gICAgICAgICAgdHlwZSA9IFwiYmxvYlwiO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChfZXJyb3IpIHt9XG4gICAgfVxuICAgIHhoci5vcGVuKFwiR0VUXCIsIGFzc2V0LnNyYywgdHJ1ZSk7XG4gICAgeGhyLnJlc3BvbnNlVHlwZSA9IHR5cGU7XG4gICAgeGhyLm9ucHJvZ3Jlc3MgPSBmdW5jdGlvbihlKSB7fTtcbiAgICB4aHIub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHRoaXMuZW1pdCgnZXJyb3InLCB4aHIuc3RhdHVzKTtcbiAgICB9O1xuICAgIHhoci5vbnJlYWR5c3RhdGVjaGFuZ2UgPSAoZnVuY3Rpb24oX3RoaXMpIHtcbiAgICAgIHJldHVybiBmdW5jdGlvbihlKSB7XG4gICAgICAgIGlmICh4aHIucmVhZHlTdGF0ZSA9PT0gNCkge1xuICAgICAgICAgIGFzc2V0LmRhdGEgPSB4aHIucmVzcG9uc2U7XG4gICAgICAgICAgX3RoaXMuZW1pdCgnbG9hZGVkJywgYXNzZXQpO1xuICAgICAgICAgIHhoci5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBudWxsO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgIH0pKHRoaXMpO1xuICAgIHJldHVybiB4aHIuc2VuZChudWxsKTtcbiAgfTtcblxuICBCaW5hcnlMb2FkZXIucHJvdG90eXBlLnJlcSA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICh3aW5kb3cuWE1MSHR0cFJlcXVlc3QpIHtcbiAgICAgIHJldHVybiBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcbiAgICB9XG4gICAgaWYgKHdpbmRvdy5BY3RpdmVYT2JqZWN0KSB7XG4gICAgICByZXR1cm4gbmV3IEFjdGl2ZVhPYmplY3QoXCJNU1hNTDIuWE1MSFRUUC4zLjBcIik7XG4gICAgfVxuICB9O1xuXG4gIHJldHVybiBCaW5hcnlMb2FkZXI7XG5cbn0pKCk7XG4iXX0=
},{"_process":5,"buffer":1,"happens":6}],10:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var DataLoader, c, happens;

happens = require('happens');

c = require('../log');

module.exports = DataLoader = (function() {
  function DataLoader() {
    happens(this);
  }

  DataLoader.prototype.load = function(asset) {
    var xhr;
    xhr = this.req();
    xhr.open("GET", asset.src, true);
    xhr.overrideMimeType("application/json");
    xhr.onprogress = function(e) {};
    xhr.onerror = function() {
      return this.emit('error', xhr.status);
    };
    xhr.onreadystatechange = (function(_this) {
      return function(e) {
        if (xhr.readyState === 4) {
          asset.data = JSON.parse(xhr.response);
          _this.emit('loaded', asset);
          xhr.onreadystatechange = null;
        }
      };
    })(this);
    return xhr.send(null);
  };

  DataLoader.prototype.req = function() {
    if (window.XMLHttpRequest) {
      return new XMLHttpRequest();
    }
    if (window.ActiveXObject) {
      return new ActiveXObject("MSXML2.XMLHTTP.3.0");
    }
  };

  return DataLoader;

})();

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/loading/data_loader.coffee","/loading")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxvYWRpbmcvZGF0YV9sb2FkZXIuY29mZmVlIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbInZhciBEYXRhTG9hZGVyLCBjLCBoYXBwZW5zO1xuXG5oYXBwZW5zID0gcmVxdWlyZSgnaGFwcGVucycpO1xuXG5jID0gcmVxdWlyZSgnLi4vbG9nJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRGF0YUxvYWRlciA9IChmdW5jdGlvbigpIHtcbiAgZnVuY3Rpb24gRGF0YUxvYWRlcigpIHtcbiAgICBoYXBwZW5zKHRoaXMpO1xuICB9XG5cbiAgRGF0YUxvYWRlci5wcm90b3R5cGUubG9hZCA9IGZ1bmN0aW9uKGFzc2V0KSB7XG4gICAgdmFyIHhocjtcbiAgICB4aHIgPSB0aGlzLnJlcSgpO1xuICAgIHhoci5vcGVuKFwiR0VUXCIsIGFzc2V0LnNyYywgdHJ1ZSk7XG4gICAgeGhyLm92ZXJyaWRlTWltZVR5cGUoXCJhcHBsaWNhdGlvbi9qc29uXCIpO1xuICAgIHhoci5vbnByb2dyZXNzID0gZnVuY3Rpb24oZSkge307XG4gICAgeGhyLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiB0aGlzLmVtaXQoJ2Vycm9yJywgeGhyLnN0YXR1cyk7XG4gICAgfTtcbiAgICB4aHIub25yZWFkeXN0YXRlY2hhbmdlID0gKGZ1bmN0aW9uKF90aGlzKSB7XG4gICAgICByZXR1cm4gZnVuY3Rpb24oZSkge1xuICAgICAgICBpZiAoeGhyLnJlYWR5U3RhdGUgPT09IDQpIHtcbiAgICAgICAgICBhc3NldC5kYXRhID0gSlNPTi5wYXJzZSh4aHIucmVzcG9uc2UpO1xuICAgICAgICAgIF90aGlzLmVtaXQoJ2xvYWRlZCcsIGFzc2V0KTtcbiAgICAgICAgICB4aHIub25yZWFkeXN0YXRlY2hhbmdlID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9KSh0aGlzKTtcbiAgICByZXR1cm4geGhyLnNlbmQobnVsbCk7XG4gIH07XG5cbiAgRGF0YUxvYWRlci5wcm90b3R5cGUucmVxID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKHdpbmRvdy5YTUxIdHRwUmVxdWVzdCkge1xuICAgICAgcmV0dXJuIG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuICAgIH1cbiAgICBpZiAod2luZG93LkFjdGl2ZVhPYmplY3QpIHtcbiAgICAgIHJldHVybiBuZXcgQWN0aXZlWE9iamVjdChcIk1TWE1MMi5YTUxIVFRQLjMuMFwiKTtcbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIERhdGFMb2FkZXI7XG5cbn0pKCk7XG4iXX0=
},{"../log":12,"_process":5,"buffer":1,"happens":6}],11:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var AsyncLoader, BinaryLoader, DataLoader, SyncLoader, c,
  bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

AsyncLoader = require('./async_loader');

DataLoader = require('./data_loader');

BinaryLoader = require('./binary_loader');

c = require('../log');


/*
Load files synchronously
 */

module.exports = SyncLoader = (function(superClass) {
  extend(SyncLoader, superClass);

  function SyncLoader() {
    this.success = bind(this.success, this);
    return SyncLoader.__super__.constructor.apply(this, arguments);
  }

  SyncLoader.prototype.load = function() {
    this.date = new Date();
    this.count = 0;
    this.total = this.manifest.length;
    if (this.manifest.length < 1) {
      return this.emit('loaded');
    } else {
      return this._load();
    }
  };

  SyncLoader.prototype._load = function() {
    var asset, l;
    asset = this.manifest[this.count];
    switch (asset.type) {
      case 'json':
      case 'xml':
        l = new DataLoader;
        l.once('loaded', this.success);
        return l.load(asset);
      case 'binary':
        l = new BinaryLoader;
        l.once('loaded', this.success);
        return l.load(asset);
    }
  };

  SyncLoader.prototype.success = function(asset) {
    this.count++;
    if (this.count >= this.total) {
      return this.emit('loaded', this.manifest);
    } else {
      return this._load();
    }
  };

  return SyncLoader;

})(AsyncLoader);

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/loading/sync_loader.coffee","/loading")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxvYWRpbmcvc3luY19sb2FkZXIuY29mZmVlIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbInZhciBBc3luY0xvYWRlciwgQmluYXJ5TG9hZGVyLCBEYXRhTG9hZGVyLCBTeW5jTG9hZGVyLCBjLFxuICBiaW5kID0gZnVuY3Rpb24oZm4sIG1lKXsgcmV0dXJuIGZ1bmN0aW9uKCl7IHJldHVybiBmbi5hcHBseShtZSwgYXJndW1lbnRzKTsgfTsgfSxcbiAgZXh0ZW5kID0gZnVuY3Rpb24oY2hpbGQsIHBhcmVudCkgeyBmb3IgKHZhciBrZXkgaW4gcGFyZW50KSB7IGlmIChoYXNQcm9wLmNhbGwocGFyZW50LCBrZXkpKSBjaGlsZFtrZXldID0gcGFyZW50W2tleV07IH0gZnVuY3Rpb24gY3RvcigpIHsgdGhpcy5jb25zdHJ1Y3RvciA9IGNoaWxkOyB9IGN0b3IucHJvdG90eXBlID0gcGFyZW50LnByb3RvdHlwZTsgY2hpbGQucHJvdG90eXBlID0gbmV3IGN0b3IoKTsgY2hpbGQuX19zdXBlcl9fID0gcGFyZW50LnByb3RvdHlwZTsgcmV0dXJuIGNoaWxkOyB9LFxuICBoYXNQcm9wID0ge30uaGFzT3duUHJvcGVydHk7XG5cbkFzeW5jTG9hZGVyID0gcmVxdWlyZSgnLi9hc3luY19sb2FkZXInKTtcblxuRGF0YUxvYWRlciA9IHJlcXVpcmUoJy4vZGF0YV9sb2FkZXInKTtcblxuQmluYXJ5TG9hZGVyID0gcmVxdWlyZSgnLi9iaW5hcnlfbG9hZGVyJyk7XG5cbmMgPSByZXF1aXJlKCcuLi9sb2cnKTtcblxuXG4vKlxuTG9hZCBmaWxlcyBzeW5jaHJvbm91c2x5XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBTeW5jTG9hZGVyID0gKGZ1bmN0aW9uKHN1cGVyQ2xhc3MpIHtcbiAgZXh0ZW5kKFN5bmNMb2FkZXIsIHN1cGVyQ2xhc3MpO1xuXG4gIGZ1bmN0aW9uIFN5bmNMb2FkZXIoKSB7XG4gICAgdGhpcy5zdWNjZXNzID0gYmluZCh0aGlzLnN1Y2Nlc3MsIHRoaXMpO1xuICAgIHJldHVybiBTeW5jTG9hZGVyLl9fc3VwZXJfXy5jb25zdHJ1Y3Rvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB9XG5cbiAgU3luY0xvYWRlci5wcm90b3R5cGUubG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZGF0ZSA9IG5ldyBEYXRlKCk7XG4gICAgdGhpcy5jb3VudCA9IDA7XG4gICAgdGhpcy50b3RhbCA9IHRoaXMubWFuaWZlc3QubGVuZ3RoO1xuICAgIGlmICh0aGlzLm1hbmlmZXN0Lmxlbmd0aCA8IDEpIHtcbiAgICAgIHJldHVybiB0aGlzLmVtaXQoJ2xvYWRlZCcpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdGhpcy5fbG9hZCgpO1xuICAgIH1cbiAgfTtcblxuICBTeW5jTG9hZGVyLnByb3RvdHlwZS5fbG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhc3NldCwgbDtcbiAgICBhc3NldCA9IHRoaXMubWFuaWZlc3RbdGhpcy5jb3VudF07XG4gICAgc3dpdGNoIChhc3NldC50eXBlKSB7XG4gICAgICBjYXNlICdqc29uJzpcbiAgICAgIGNhc2UgJ3htbCc6XG4gICAgICAgIGwgPSBuZXcgRGF0YUxvYWRlcjtcbiAgICAgICAgbC5vbmNlKCdsb2FkZWQnLCB0aGlzLnN1Y2Nlc3MpO1xuICAgICAgICByZXR1cm4gbC5sb2FkKGFzc2V0KTtcbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIGwgPSBuZXcgQmluYXJ5TG9hZGVyO1xuICAgICAgICBsLm9uY2UoJ2xvYWRlZCcsIHRoaXMuc3VjY2Vzcyk7XG4gICAgICAgIHJldHVybiBsLmxvYWQoYXNzZXQpO1xuICAgIH1cbiAgfTtcblxuICBTeW5jTG9hZGVyLnByb3RvdHlwZS5zdWNjZXNzID0gZnVuY3Rpb24oYXNzZXQpIHtcbiAgICB0aGlzLmNvdW50Kys7XG4gICAgaWYgKHRoaXMuY291bnQgPj0gdGhpcy50b3RhbCkge1xuICAgICAgcmV0dXJuIHRoaXMuZW1pdCgnbG9hZGVkJywgdGhpcy5tYW5pZmVzdCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0aGlzLl9sb2FkKCk7XG4gICAgfVxuICB9O1xuXG4gIHJldHVybiBTeW5jTG9hZGVyO1xuXG59KShBc3luY0xvYWRlcik7XG4iXX0=
},{"../log":12,"./async_loader":8,"./binary_loader":9,"./data_loader":10,"_process":5,"buffer":1}],12:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var log,
  slice = [].slice;

log = {};

log.enable = false;

log.clear = function() {
  if ((typeof console !== "undefined" && console !== null) && (console.clear != null)) {
    return console.clear();
  }
};

log.log = function() {
  var args;
  args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
  if (this.enable) {
    if ((typeof console !== "undefined" && console !== null) && (console.log != null) && (console.log.apply != null)) {
      return console.log.apply(console, args);
    } else {
      return console.log(args);
    }
  }
};

log.debug = function() {
  var args;
  args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
  if (this.enable) {
    if ((typeof console !== "undefined" && console !== null) && (console.debug != null) && (console.debug.apply != null)) {
      return console.debug.apply(console, args);
    } else {
      return console.log(args);
    }
  }
};

log.info = function() {
  var args;
  args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
  if (this.enable) {
    if ((typeof console !== "undefined" && console !== null) && (console.info != null) && (console.info.apply != null)) {
      return console.info.apply(console, args);
    } else {
      return console.log(args);
    }
  }
};

log.warn = function() {
  var args;
  args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
  if (this.enable) {
    if ((typeof console !== "undefined" && console !== null) && (console.warn != null) && (console.warn.apply != null)) {
      return console.warn.apply(console, args);
    } else {
      return console.log(args);
    }
  }
};

log.error = function() {
  var args;
  args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
  if (this.enable) {
    if ((typeof console !== "undefined" && console !== null) && (console.error != null) && (console.error.apply != null)) {
      return console.error.apply(console, args);
    } else {
      return console.log(args);
    }
  }
};

module.exports = log;

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/log.coffee","/")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxvZy5jb2ZmZWUiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsidmFyIGxvZyxcbiAgc2xpY2UgPSBbXS5zbGljZTtcblxubG9nID0ge307XG5cbmxvZy5lbmFibGUgPSBmYWxzZTtcblxubG9nLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGlmICgodHlwZW9mIGNvbnNvbGUgIT09IFwidW5kZWZpbmVkXCIgJiYgY29uc29sZSAhPT0gbnVsbCkgJiYgKGNvbnNvbGUuY2xlYXIgIT0gbnVsbCkpIHtcbiAgICByZXR1cm4gY29uc29sZS5jbGVhcigpO1xuICB9XG59O1xuXG5sb2cubG9nID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmdzO1xuICBhcmdzID0gMSA8PSBhcmd1bWVudHMubGVuZ3RoID8gc2xpY2UuY2FsbChhcmd1bWVudHMsIDApIDogW107XG4gIGlmICh0aGlzLmVuYWJsZSkge1xuICAgIGlmICgodHlwZW9mIGNvbnNvbGUgIT09IFwidW5kZWZpbmVkXCIgJiYgY29uc29sZSAhPT0gbnVsbCkgJiYgKGNvbnNvbGUubG9nICE9IG51bGwpICYmIChjb25zb2xlLmxvZy5hcHBseSAhPSBudWxsKSkge1xuICAgICAgcmV0dXJuIGNvbnNvbGUubG9nLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gY29uc29sZS5sb2coYXJncyk7XG4gICAgfVxuICB9XG59O1xuXG5sb2cuZGVidWcgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGFyZ3M7XG4gIGFyZ3MgPSAxIDw9IGFyZ3VtZW50cy5sZW5ndGggPyBzbGljZS5jYWxsKGFyZ3VtZW50cywgMCkgOiBbXTtcbiAgaWYgKHRoaXMuZW5hYmxlKSB7XG4gICAgaWYgKCh0eXBlb2YgY29uc29sZSAhPT0gXCJ1bmRlZmluZWRcIiAmJiBjb25zb2xlICE9PSBudWxsKSAmJiAoY29uc29sZS5kZWJ1ZyAhPSBudWxsKSAmJiAoY29uc29sZS5kZWJ1Zy5hcHBseSAhPSBudWxsKSkge1xuICAgICAgcmV0dXJuIGNvbnNvbGUuZGVidWcuYXBwbHkoY29uc29sZSwgYXJncyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBjb25zb2xlLmxvZyhhcmdzKTtcbiAgICB9XG4gIH1cbn07XG5cbmxvZy5pbmZvID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmdzO1xuICBhcmdzID0gMSA8PSBhcmd1bWVudHMubGVuZ3RoID8gc2xpY2UuY2FsbChhcmd1bWVudHMsIDApIDogW107XG4gIGlmICh0aGlzLmVuYWJsZSkge1xuICAgIGlmICgodHlwZW9mIGNvbnNvbGUgIT09IFwidW5kZWZpbmVkXCIgJiYgY29uc29sZSAhPT0gbnVsbCkgJiYgKGNvbnNvbGUuaW5mbyAhPSBudWxsKSAmJiAoY29uc29sZS5pbmZvLmFwcGx5ICE9IG51bGwpKSB7XG4gICAgICByZXR1cm4gY29uc29sZS5pbmZvLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gY29uc29sZS5sb2coYXJncyk7XG4gICAgfVxuICB9XG59O1xuXG5sb2cud2FybiA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYXJncztcbiAgYXJncyA9IDEgPD0gYXJndW1lbnRzLmxlbmd0aCA/IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAwKSA6IFtdO1xuICBpZiAodGhpcy5lbmFibGUpIHtcbiAgICBpZiAoKHR5cGVvZiBjb25zb2xlICE9PSBcInVuZGVmaW5lZFwiICYmIGNvbnNvbGUgIT09IG51bGwpICYmIChjb25zb2xlLndhcm4gIT0gbnVsbCkgJiYgKGNvbnNvbGUud2Fybi5hcHBseSAhPSBudWxsKSkge1xuICAgICAgcmV0dXJuIGNvbnNvbGUud2Fybi5hcHBseShjb25zb2xlLCBhcmdzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGNvbnNvbGUubG9nKGFyZ3MpO1xuICAgIH1cbiAgfVxufTtcblxubG9nLmVycm9yID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmdzO1xuICBhcmdzID0gMSA8PSBhcmd1bWVudHMubGVuZ3RoID8gc2xpY2UuY2FsbChhcmd1bWVudHMsIDApIDogW107XG4gIGlmICh0aGlzLmVuYWJsZSkge1xuICAgIGlmICgodHlwZW9mIGNvbnNvbGUgIT09IFwidW5kZWZpbmVkXCIgJiYgY29uc29sZSAhPT0gbnVsbCkgJiYgKGNvbnNvbGUuZXJyb3IgIT0gbnVsbCkgJiYgKGNvbnNvbGUuZXJyb3IuYXBwbHkgIT0gbnVsbCkpIHtcbiAgICAgIHJldHVybiBjb25zb2xlLmVycm9yLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gY29uc29sZS5sb2coYXJncyk7XG4gICAgfVxuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGxvZztcbiJdfQ==
},{"_process":5,"buffer":1}],13:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var c, happens;

happens = require('happens');

c = require('./log');

exports.PlaybackMode = (function() {
  _Class.prototype.playing = false;

  _Class.prototype.paused = false;

  _Class.prototype.frame = 0;

  _Class.prototype.total_frames = 0;

  _Class.prototype.duration = 1;

  _Class.prototype.percent = 0;

  _Class.prototype.loop = false;

  _Class.prototype.status = '';

  function _Class() {
    happens(this);
  }

  _Class.prototype.play = function(duration) {
    var params;
    this.duration = duration;
    params = {
      frame: this.total_frames,
      ease: Linear.easeNone,
      onStart: (function(_this) {
        return function() {
          _this.playing = true;
          _this.status = 'playing';
          return _this.emit('start');
        };
      })(this),
      onUpdate: (function(_this) {
        return function() {
          _this.percent = _this.frame / _this.total_frames;
          return _this.emit('update');
        };
      })(this),
      onComplete: (function(_this) {
        return function() {
          _this.frame = 0;
          if (_this.loop) {
            return _this.play(_this.duration);
          } else {
            return _this.stop();
          }
        };
      })(this)
    };
    return this.tween = TweenLite.to(this, this.duration, params);
  };


  /*
  	Pause the playback
   */

  _Class.prototype.pause = function() {
    c.debug('paused');
    this.status = 'buffering';
    this.paused = true;
    this.tween.pause();
    return this.emit('pause');
  };


  /*
  	Pause the playback
   */

  _Class.prototype.resume = function() {
    var ref;
    if (!this.playing) {
      return;
    }
    if (this.paused) {
      return;
    }
    this.status = 'playing';
    this.paused = false;
    if ((ref = this.tween) != null) {
      ref.play();
    }
    return this.emit('resume');
  };

  _Class.prototype.stop = function() {
    this.playing = false;
    this.status = 'stopped';
    return this.emit('stop');
  };

  _Class.prototype.get_frame = function() {
    var frame;
    frame = Math.floor(this.frame);
    frame = Math.min(frame, this.total_frames);
    frame = Math.max(frame, 0);
    return frame;
  };

  return _Class;

})();

exports.FrameMode = (function() {
  _Class.prototype.playing = false;

  _Class.prototype.paused = false;

  _Class.prototype.frame = 0;

  _Class.prototype.total_frames = 0;

  _Class.prototype.duration = 1;

  _Class.prototype.percent = 0;

  _Class.prototype.status = '';

  function _Class() {
    happens(this);
  }

  _Class.prototype.set_frame = function(frame1) {
    this.frame = frame1;
    return this.percent = this.frame / this.total_frames;
  };

  _Class.prototype.get_frame = function() {
    return this.frame;
  };

  _Class.prototype.get_frame = function() {
    var frame;
    frame = Math.floor(this.frame);
    frame = Math.min(frame, this.total_frames);
    return frame = Math.max(frame, 0);
  };

  return _Class;

})();

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/modes.coffee","/")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1vZGVzLmNvZmZlZSJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbInZhciBjLCBoYXBwZW5zO1xuXG5oYXBwZW5zID0gcmVxdWlyZSgnaGFwcGVucycpO1xuXG5jID0gcmVxdWlyZSgnLi9sb2cnKTtcblxuZXhwb3J0cy5QbGF5YmFja01vZGUgPSAoZnVuY3Rpb24oKSB7XG4gIF9DbGFzcy5wcm90b3R5cGUucGxheWluZyA9IGZhbHNlO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUucGF1c2VkID0gZmFsc2U7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5mcmFtZSA9IDA7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS50b3RhbF9mcmFtZXMgPSAwO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUuZHVyYXRpb24gPSAxO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUucGVyY2VudCA9IDA7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5sb29wID0gZmFsc2U7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5zdGF0dXMgPSAnJztcblxuICBmdW5jdGlvbiBfQ2xhc3MoKSB7XG4gICAgaGFwcGVucyh0aGlzKTtcbiAgfVxuXG4gIF9DbGFzcy5wcm90b3R5cGUucGxheSA9IGZ1bmN0aW9uKGR1cmF0aW9uKSB7XG4gICAgdmFyIHBhcmFtcztcbiAgICB0aGlzLmR1cmF0aW9uID0gZHVyYXRpb247XG4gICAgcGFyYW1zID0ge1xuICAgICAgZnJhbWU6IHRoaXMudG90YWxfZnJhbWVzLFxuICAgICAgZWFzZTogTGluZWFyLmVhc2VOb25lLFxuICAgICAgb25TdGFydDogKGZ1bmN0aW9uKF90aGlzKSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBfdGhpcy5wbGF5aW5nID0gdHJ1ZTtcbiAgICAgICAgICBfdGhpcy5zdGF0dXMgPSAncGxheWluZyc7XG4gICAgICAgICAgcmV0dXJuIF90aGlzLmVtaXQoJ3N0YXJ0Jyk7XG4gICAgICAgIH07XG4gICAgICB9KSh0aGlzKSxcbiAgICAgIG9uVXBkYXRlOiAoZnVuY3Rpb24oX3RoaXMpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIF90aGlzLnBlcmNlbnQgPSBfdGhpcy5mcmFtZSAvIF90aGlzLnRvdGFsX2ZyYW1lcztcbiAgICAgICAgICByZXR1cm4gX3RoaXMuZW1pdCgndXBkYXRlJyk7XG4gICAgICAgIH07XG4gICAgICB9KSh0aGlzKSxcbiAgICAgIG9uQ29tcGxldGU6IChmdW5jdGlvbihfdGhpcykge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgX3RoaXMuZnJhbWUgPSAwO1xuICAgICAgICAgIGlmIChfdGhpcy5sb29wKSB7XG4gICAgICAgICAgICByZXR1cm4gX3RoaXMucGxheShfdGhpcy5kdXJhdGlvbik7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBfdGhpcy5zdG9wKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgfSkodGhpcylcbiAgICB9O1xuICAgIHJldHVybiB0aGlzLnR3ZWVuID0gVHdlZW5MaXRlLnRvKHRoaXMsIHRoaXMuZHVyYXRpb24sIHBhcmFtcyk7XG4gIH07XG5cblxuICAvKlxuICBcdFBhdXNlIHRoZSBwbGF5YmFja1xuICAgKi9cblxuICBfQ2xhc3MucHJvdG90eXBlLnBhdXNlID0gZnVuY3Rpb24oKSB7XG4gICAgYy5kZWJ1ZygncGF1c2VkJyk7XG4gICAgdGhpcy5zdGF0dXMgPSAnYnVmZmVyaW5nJztcbiAgICB0aGlzLnBhdXNlZCA9IHRydWU7XG4gICAgdGhpcy50d2Vlbi5wYXVzZSgpO1xuICAgIHJldHVybiB0aGlzLmVtaXQoJ3BhdXNlJyk7XG4gIH07XG5cblxuICAvKlxuICBcdFBhdXNlIHRoZSBwbGF5YmFja1xuICAgKi9cblxuICBfQ2xhc3MucHJvdG90eXBlLnJlc3VtZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZWY7XG4gICAgaWYgKCF0aGlzLnBsYXlpbmcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMucGF1c2VkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc3RhdHVzID0gJ3BsYXlpbmcnO1xuICAgIHRoaXMucGF1c2VkID0gZmFsc2U7XG4gICAgaWYgKChyZWYgPSB0aGlzLnR3ZWVuKSAhPSBudWxsKSB7XG4gICAgICByZWYucGxheSgpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5lbWl0KCdyZXN1bWUnKTtcbiAgfTtcblxuICBfQ2xhc3MucHJvdG90eXBlLnN0b3AgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnBsYXlpbmcgPSBmYWxzZTtcbiAgICB0aGlzLnN0YXR1cyA9ICdzdG9wcGVkJztcbiAgICByZXR1cm4gdGhpcy5lbWl0KCdzdG9wJyk7XG4gIH07XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5nZXRfZnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZnJhbWU7XG4gICAgZnJhbWUgPSBNYXRoLmZsb29yKHRoaXMuZnJhbWUpO1xuICAgIGZyYW1lID0gTWF0aC5taW4oZnJhbWUsIHRoaXMudG90YWxfZnJhbWVzKTtcbiAgICBmcmFtZSA9IE1hdGgubWF4KGZyYW1lLCAwKTtcbiAgICByZXR1cm4gZnJhbWU7XG4gIH07XG5cbiAgcmV0dXJuIF9DbGFzcztcblxufSkoKTtcblxuZXhwb3J0cy5GcmFtZU1vZGUgPSAoZnVuY3Rpb24oKSB7XG4gIF9DbGFzcy5wcm90b3R5cGUucGxheWluZyA9IGZhbHNlO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUucGF1c2VkID0gZmFsc2U7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5mcmFtZSA9IDA7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS50b3RhbF9mcmFtZXMgPSAwO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUuZHVyYXRpb24gPSAxO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUucGVyY2VudCA9IDA7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5zdGF0dXMgPSAnJztcblxuICBmdW5jdGlvbiBfQ2xhc3MoKSB7XG4gICAgaGFwcGVucyh0aGlzKTtcbiAgfVxuXG4gIF9DbGFzcy5wcm90b3R5cGUuc2V0X2ZyYW1lID0gZnVuY3Rpb24oZnJhbWUxKSB7XG4gICAgdGhpcy5mcmFtZSA9IGZyYW1lMTtcbiAgICByZXR1cm4gdGhpcy5wZXJjZW50ID0gdGhpcy5mcmFtZSAvIHRoaXMudG90YWxfZnJhbWVzO1xuICB9O1xuXG4gIF9DbGFzcy5wcm90b3R5cGUuZ2V0X2ZyYW1lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZnJhbWU7XG4gIH07XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5nZXRfZnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZnJhbWU7XG4gICAgZnJhbWUgPSBNYXRoLmZsb29yKHRoaXMuZnJhbWUpO1xuICAgIGZyYW1lID0gTWF0aC5taW4oZnJhbWUsIHRoaXMudG90YWxfZnJhbWVzKTtcbiAgICByZXR1cm4gZnJhbWUgPSBNYXRoLm1heChmcmFtZSwgMCk7XG4gIH07XG5cbiAgcmV0dXJuIF9DbGFzcztcblxufSkoKTtcbiJdfQ==
},{"./log":12,"_process":5,"buffer":1,"happens":6}],14:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var SequencePlayer, Util,
  bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

module.exports = SequencePlayer = (function() {
  SequencePlayer.prototype.mode = null;

  SequencePlayer.prototype.current_frame = null;

  SequencePlayer.prototype.frame_width = 0;

  SequencePlayer.prototype.frame_height = 0;

  function SequencePlayer(el) {
    this.el = el;
    this.fullscreen_resize = bind(this.fullscreen_resize, this);
    this.update = bind(this.update, this);
    this.set_size = bind(this.set_size, this);

    /*
    		Create frame
     */
    this.image = document.createElement('img');
    this.el.appendChild(this.image);
    this.buffer = [];
  }


  /*
  	Update the images buffer
   */

  SequencePlayer.prototype.update_buffer = function(images) {
    return this.buffer = this.buffer.concat(images);
  };


  /*
  	Set the size of the player
   */

  SequencePlayer.prototype.set_size = function(width, height) {
    this.width = width;
    this.height = height;
    this.el.style.width = this.width + "px";
    this.el.style.height = this.height + "px";
    return Util.resize(this.image, this.frame_width, this.frame_height, this.width, this.height);
  };

  SequencePlayer.prototype.set_mode = function(mode) {
    var ref;
    if ((ref = this.mode) != null) {
      ref.off('update', this.update);
    }
    this.mode = mode;
    return this.mode.on('update', this.update);
  };

  SequencePlayer.prototype.update = function() {
    var frame, image;
    if (this.mode == null) {
      return;
    }
    frame = this.mode.get_frame();
    if (frame !== this.current_frame) {
      this.current_frame = frame;
      image = this.buffer[this.current_frame];
      if (image == null) {
        return this.mode.pause();
      } else {
        return this.image.setAttribute('src', image.src);
      }
    }
  };

  SequencePlayer.prototype.get_current_frame_image = function() {
    return this.buffer[this.current_frame];
  };


  /*
  	Enable the automatic resizing of the sequencer container on window resize
   */

  SequencePlayer.prototype.enable_fullscreen_resize = function() {
    window.addEventListener('resize', this.fullscreen_resize);
    return this.fullscreen_resize();
  };


  /*
  	Disable the automatic resizing of the sequencer container on window resize
   */

  SequencePlayer.prototype.disable_fullscreen_resize = function() {
    return window.removeEventListener('resize', this.fullscreen_resize);
  };

  SequencePlayer.prototype.fullscreen_resize = function() {
    return this.set_size(window.innerWidth, window.innerHeight);
  };

  return SequencePlayer;

})();

Util = {
  calculate_resize: function(image_width, image_height, win_width, win_height) {
    var image_ratio1, image_ratio2, new_height, new_left, new_top, new_width, window_ratio;
    window_ratio = win_width / win_height;
    image_ratio1 = image_width / image_height;
    image_ratio2 = image_height / image_width;
    if (window_ratio < image_ratio1) {
      new_height = win_height;
      new_width = Math.round(new_height * image_ratio1);
      new_top = 0;
      new_left = (win_width * .5) - (new_width * .5);
    } else {
      new_width = win_width;
      new_height = Math.round(new_width * image_ratio2);
      new_top = (win_height * .5) - (new_height * .5);
      new_left = 0;
    }
    return {
      x: new_left,
      y: new_top,
      width: new_width,
      height: new_height
    };
  },

  /*
  	Resize image(s) to the browser size retaining aspect ratio
  	@param [jQuery]  $images
  	@param [Number]  image_width
  	@param [Number]  image_height
  	@param [Number]  win_width
  	@param [Number]  win_width
  	@param [Boolean] backgroundsize
   */
  resize: function(image, image_width, image_height, win_width, win_height) {
    var data;
    data = this.calculate_resize(image_width, image_height, win_width, win_height);
    image.style.marginTop = data.y + "px";
    image.style.marginLeft = data.x + "px";
    image.style.width = data.width + "px";
    return image.style.height = data.height + "px";
  }
};

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/player.coffee","/")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInBsYXllci5jb2ZmZWUiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbInZhciBTZXF1ZW5jZVBsYXllciwgVXRpbCxcbiAgYmluZCA9IGZ1bmN0aW9uKGZuLCBtZSl7IHJldHVybiBmdW5jdGlvbigpeyByZXR1cm4gZm4uYXBwbHkobWUsIGFyZ3VtZW50cyk7IH07IH07XG5cbm1vZHVsZS5leHBvcnRzID0gU2VxdWVuY2VQbGF5ZXIgPSAoZnVuY3Rpb24oKSB7XG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS5tb2RlID0gbnVsbDtcblxuICBTZXF1ZW5jZVBsYXllci5wcm90b3R5cGUuY3VycmVudF9mcmFtZSA9IG51bGw7XG5cbiAgU2VxdWVuY2VQbGF5ZXIucHJvdG90eXBlLmZyYW1lX3dpZHRoID0gMDtcblxuICBTZXF1ZW5jZVBsYXllci5wcm90b3R5cGUuZnJhbWVfaGVpZ2h0ID0gMDtcblxuICBmdW5jdGlvbiBTZXF1ZW5jZVBsYXllcihlbCkge1xuICAgIHRoaXMuZWwgPSBlbDtcbiAgICB0aGlzLmZ1bGxzY3JlZW5fcmVzaXplID0gYmluZCh0aGlzLmZ1bGxzY3JlZW5fcmVzaXplLCB0aGlzKTtcbiAgICB0aGlzLnVwZGF0ZSA9IGJpbmQodGhpcy51cGRhdGUsIHRoaXMpO1xuICAgIHRoaXMuc2V0X3NpemUgPSBiaW5kKHRoaXMuc2V0X3NpemUsIHRoaXMpO1xuXG4gICAgLypcbiAgICBcdFx0Q3JlYXRlIGZyYW1lXG4gICAgICovXG4gICAgdGhpcy5pbWFnZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2ltZycpO1xuICAgIHRoaXMuZWwuYXBwZW5kQ2hpbGQodGhpcy5pbWFnZSk7XG4gICAgdGhpcy5idWZmZXIgPSBbXTtcbiAgfVxuXG5cbiAgLypcbiAgXHRVcGRhdGUgdGhlIGltYWdlcyBidWZmZXJcbiAgICovXG5cbiAgU2VxdWVuY2VQbGF5ZXIucHJvdG90eXBlLnVwZGF0ZV9idWZmZXIgPSBmdW5jdGlvbihpbWFnZXMpIHtcbiAgICByZXR1cm4gdGhpcy5idWZmZXIgPSB0aGlzLmJ1ZmZlci5jb25jYXQoaW1hZ2VzKTtcbiAgfTtcblxuXG4gIC8qXG4gIFx0U2V0IHRoZSBzaXplIG9mIHRoZSBwbGF5ZXJcbiAgICovXG5cbiAgU2VxdWVuY2VQbGF5ZXIucHJvdG90eXBlLnNldF9zaXplID0gZnVuY3Rpb24od2lkdGgsIGhlaWdodCkge1xuICAgIHRoaXMud2lkdGggPSB3aWR0aDtcbiAgICB0aGlzLmhlaWdodCA9IGhlaWdodDtcbiAgICB0aGlzLmVsLnN0eWxlLndpZHRoID0gdGhpcy53aWR0aCArIFwicHhcIjtcbiAgICB0aGlzLmVsLnN0eWxlLmhlaWdodCA9IHRoaXMuaGVpZ2h0ICsgXCJweFwiO1xuICAgIHJldHVybiBVdGlsLnJlc2l6ZSh0aGlzLmltYWdlLCB0aGlzLmZyYW1lX3dpZHRoLCB0aGlzLmZyYW1lX2hlaWdodCwgdGhpcy53aWR0aCwgdGhpcy5oZWlnaHQpO1xuICB9O1xuXG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS5zZXRfbW9kZSA9IGZ1bmN0aW9uKG1vZGUpIHtcbiAgICB2YXIgcmVmO1xuICAgIGlmICgocmVmID0gdGhpcy5tb2RlKSAhPSBudWxsKSB7XG4gICAgICByZWYub2ZmKCd1cGRhdGUnLCB0aGlzLnVwZGF0ZSk7XG4gICAgfVxuICAgIHRoaXMubW9kZSA9IG1vZGU7XG4gICAgcmV0dXJuIHRoaXMubW9kZS5vbigndXBkYXRlJywgdGhpcy51cGRhdGUpO1xuICB9O1xuXG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZnJhbWUsIGltYWdlO1xuICAgIGlmICh0aGlzLm1vZGUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmcmFtZSA9IHRoaXMubW9kZS5nZXRfZnJhbWUoKTtcbiAgICBpZiAoZnJhbWUgIT09IHRoaXMuY3VycmVudF9mcmFtZSkge1xuICAgICAgdGhpcy5jdXJyZW50X2ZyYW1lID0gZnJhbWU7XG4gICAgICBpbWFnZSA9IHRoaXMuYnVmZmVyW3RoaXMuY3VycmVudF9mcmFtZV07XG4gICAgICBpZiAoaW1hZ2UgPT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5tb2RlLnBhdXNlKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdGhpcy5pbWFnZS5zZXRBdHRyaWJ1dGUoJ3NyYycsIGltYWdlLnNyYyk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS5nZXRfY3VycmVudF9mcmFtZV9pbWFnZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmJ1ZmZlclt0aGlzLmN1cnJlbnRfZnJhbWVdO1xuICB9O1xuXG5cbiAgLypcbiAgXHRFbmFibGUgdGhlIGF1dG9tYXRpYyByZXNpemluZyBvZiB0aGUgc2VxdWVuY2VyIGNvbnRhaW5lciBvbiB3aW5kb3cgcmVzaXplXG4gICAqL1xuXG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS5lbmFibGVfZnVsbHNjcmVlbl9yZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgdGhpcy5mdWxsc2NyZWVuX3Jlc2l6ZSk7XG4gICAgcmV0dXJuIHRoaXMuZnVsbHNjcmVlbl9yZXNpemUoKTtcbiAgfTtcblxuXG4gIC8qXG4gIFx0RGlzYWJsZSB0aGUgYXV0b21hdGljIHJlc2l6aW5nIG9mIHRoZSBzZXF1ZW5jZXIgY29udGFpbmVyIG9uIHdpbmRvdyByZXNpemVcbiAgICovXG5cbiAgU2VxdWVuY2VQbGF5ZXIucHJvdG90eXBlLmRpc2FibGVfZnVsbHNjcmVlbl9yZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIHRoaXMuZnVsbHNjcmVlbl9yZXNpemUpO1xuICB9O1xuXG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS5mdWxsc2NyZWVuX3Jlc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLnNldF9zaXplKHdpbmRvdy5pbm5lcldpZHRoLCB3aW5kb3cuaW5uZXJIZWlnaHQpO1xuICB9O1xuXG4gIHJldHVybiBTZXF1ZW5jZVBsYXllcjtcblxufSkoKTtcblxuVXRpbCA9IHtcbiAgY2FsY3VsYXRlX3Jlc2l6ZTogZnVuY3Rpb24oaW1hZ2Vfd2lkdGgsIGltYWdlX2hlaWdodCwgd2luX3dpZHRoLCB3aW5faGVpZ2h0KSB7XG4gICAgdmFyIGltYWdlX3JhdGlvMSwgaW1hZ2VfcmF0aW8yLCBuZXdfaGVpZ2h0LCBuZXdfbGVmdCwgbmV3X3RvcCwgbmV3X3dpZHRoLCB3aW5kb3dfcmF0aW87XG4gICAgd2luZG93X3JhdGlvID0gd2luX3dpZHRoIC8gd2luX2hlaWdodDtcbiAgICBpbWFnZV9yYXRpbzEgPSBpbWFnZV93aWR0aCAvIGltYWdlX2hlaWdodDtcbiAgICBpbWFnZV9yYXRpbzIgPSBpbWFnZV9oZWlnaHQgLyBpbWFnZV93aWR0aDtcbiAgICBpZiAod2luZG93X3JhdGlvIDwgaW1hZ2VfcmF0aW8xKSB7XG4gICAgICBuZXdfaGVpZ2h0ID0gd2luX2hlaWdodDtcbiAgICAgIG5ld193aWR0aCA9IE1hdGgucm91bmQobmV3X2hlaWdodCAqIGltYWdlX3JhdGlvMSk7XG4gICAgICBuZXdfdG9wID0gMDtcbiAgICAgIG5ld19sZWZ0ID0gKHdpbl93aWR0aCAqIC41KSAtIChuZXdfd2lkdGggKiAuNSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ld193aWR0aCA9IHdpbl93aWR0aDtcbiAgICAgIG5ld19oZWlnaHQgPSBNYXRoLnJvdW5kKG5ld193aWR0aCAqIGltYWdlX3JhdGlvMik7XG4gICAgICBuZXdfdG9wID0gKHdpbl9oZWlnaHQgKiAuNSkgLSAobmV3X2hlaWdodCAqIC41KTtcbiAgICAgIG5ld19sZWZ0ID0gMDtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIHg6IG5ld19sZWZ0LFxuICAgICAgeTogbmV3X3RvcCxcbiAgICAgIHdpZHRoOiBuZXdfd2lkdGgsXG4gICAgICBoZWlnaHQ6IG5ld19oZWlnaHRcbiAgICB9O1xuICB9LFxuXG4gIC8qXG4gIFx0UmVzaXplIGltYWdlKHMpIHRvIHRoZSBicm93c2VyIHNpemUgcmV0YWluaW5nIGFzcGVjdCByYXRpb1xuICBcdEBwYXJhbSBbalF1ZXJ5XSAgJGltYWdlc1xuICBcdEBwYXJhbSBbTnVtYmVyXSAgaW1hZ2Vfd2lkdGhcbiAgXHRAcGFyYW0gW051bWJlcl0gIGltYWdlX2hlaWdodFxuICBcdEBwYXJhbSBbTnVtYmVyXSAgd2luX3dpZHRoXG4gIFx0QHBhcmFtIFtOdW1iZXJdICB3aW5fd2lkdGhcbiAgXHRAcGFyYW0gW0Jvb2xlYW5dIGJhY2tncm91bmRzaXplXG4gICAqL1xuICByZXNpemU6IGZ1bmN0aW9uKGltYWdlLCBpbWFnZV93aWR0aCwgaW1hZ2VfaGVpZ2h0LCB3aW5fd2lkdGgsIHdpbl9oZWlnaHQpIHtcbiAgICB2YXIgZGF0YTtcbiAgICBkYXRhID0gdGhpcy5jYWxjdWxhdGVfcmVzaXplKGltYWdlX3dpZHRoLCBpbWFnZV9oZWlnaHQsIHdpbl93aWR0aCwgd2luX2hlaWdodCk7XG4gICAgaW1hZ2Uuc3R5bGUubWFyZ2luVG9wID0gZGF0YS55ICsgXCJweFwiO1xuICAgIGltYWdlLnN0eWxlLm1hcmdpbkxlZnQgPSBkYXRhLnggKyBcInB4XCI7XG4gICAgaW1hZ2Uuc3R5bGUud2lkdGggPSBkYXRhLndpZHRoICsgXCJweFwiO1xuICAgIHJldHVybiBpbWFnZS5zdHlsZS5oZWlnaHQgPSBkYXRhLmhlaWdodCArIFwicHhcIjtcbiAgfVxufTtcbiJdfQ==
},{"_process":5,"buffer":1}],15:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
module.exports = {

  /*
  	https://gist.github.com/svlasov-gists/2383751
   */
  merge: function(target, source) {
    var a, l, property, sourceProperty;
    if (typeof target !== "object") {
      target = {};
    }
    for (property in source) {
      if (source.hasOwnProperty(property)) {
        sourceProperty = source[property];
        if (typeof sourceProperty === "object") {
          target[property] = this.merge(target[property], sourceProperty);
          continue;
        }
        target[property] = sourceProperty;
      }
    }
    a = 2;
    l = arguments.length;
    while (a < l) {
      merge(target, arguments[a]);
      a++;
    }
    return target;
  }
};

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/utils.coffee","/")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInV0aWxzLmNvZmZlZSJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyJtb2R1bGUuZXhwb3J0cyA9IHtcblxuICAvKlxuICBcdGh0dHBzOi8vZ2lzdC5naXRodWIuY29tL3N2bGFzb3YtZ2lzdHMvMjM4Mzc1MVxuICAgKi9cbiAgbWVyZ2U6IGZ1bmN0aW9uKHRhcmdldCwgc291cmNlKSB7XG4gICAgdmFyIGEsIGwsIHByb3BlcnR5LCBzb3VyY2VQcm9wZXJ0eTtcbiAgICBpZiAodHlwZW9mIHRhcmdldCAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGFyZ2V0ID0ge307XG4gICAgfVxuICAgIGZvciAocHJvcGVydHkgaW4gc291cmNlKSB7XG4gICAgICBpZiAoc291cmNlLmhhc093blByb3BlcnR5KHByb3BlcnR5KSkge1xuICAgICAgICBzb3VyY2VQcm9wZXJ0eSA9IHNvdXJjZVtwcm9wZXJ0eV07XG4gICAgICAgIGlmICh0eXBlb2Ygc291cmNlUHJvcGVydHkgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgICB0YXJnZXRbcHJvcGVydHldID0gdGhpcy5tZXJnZSh0YXJnZXRbcHJvcGVydHldLCBzb3VyY2VQcm9wZXJ0eSk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgdGFyZ2V0W3Byb3BlcnR5XSA9IHNvdXJjZVByb3BlcnR5O1xuICAgICAgfVxuICAgIH1cbiAgICBhID0gMjtcbiAgICBsID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICB3aGlsZSAoYSA8IGwpIHtcbiAgICAgIG1lcmdlKHRhcmdldCwgYXJndW1lbnRzW2FdKTtcbiAgICAgIGErKztcbiAgICB9XG4gICAgcmV0dXJuIHRhcmdldDtcbiAgfVxufTtcbiJdfQ==
},{"_process":5,"buffer":1}],16:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var SequenceLoader, SequencePlayer, Utils, Vimage, happens,
  bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

happens = require('happens');

Utils = require('./utils');

SequenceLoader = require('./loader');

SequencePlayer = require('./player');

module.exports = window.Vimage = Vimage = (function() {
  function Vimage(options) {
    if (options == null) {
      options = {};
    }
    this.buffer_complete = bind(this.buffer_complete, this);
    this.update_buffer = bind(this.update_buffer, this);
    this.data_loaded = bind(this.data_loaded, this);
    happens(this);
    this.options = {
      'element': null,
      'autoplay': true,
      'fullscreen': false,
      'buffer_percent': 0.1,
      'type': 'video'
    };
    Utils.merge(this.options, options);
    this.options.element = document.getElementById(this.options.element);
    this.player = new SequencePlayer(this.options.element);
    this.modes = require('./modes');
    this.loader = new SequenceLoader;
  }

  Vimage.prototype.load = function(file) {
    this.loader.on('buffer:update', this.update_buffer);
    this.loader.once('buffer:complete', this.buffer_complete);
    this.loader.once('data:loaded', this.data_loaded);
    return this.loader.load(file);
  };

  Vimage.prototype.set_mode = function(mode) {
    this.mode = mode;
    return this.player.set_mode(this.mode);
  };

  Vimage.prototype.data_loaded = function() {
    this.player.frame_width = this.loader.data.width;
    this.player.frame_height = this.loader.data.height;
    this.player.set_size(this.loader.data.width, this.loader.data.height);
    if (this.options.fullscreen) {
      this.player.enable_fullscreen_resize();
    }

    /*
    		Play the mode after the first packs have loaded
     */
    return this.mode.total_frames = this.loader.data.total_frames;
  };


  /*
  	Update the images buffer
   */

  Vimage.prototype.update_buffer = function(images) {
    this.player.update_buffer(images);
    if (this.options.type === 'video') {
      if (this.mode.playing === false && this.options.autoplay && this.loader.percent_loaded >= this.options.buffer_percent) {
        this.mode.play(this.loader.data.duration);
      }
      if (this.mode.pause) {
        return this.mode.resume();
      }
    }
  };


  /*
  	After all the packs have loaded
   */

  Vimage.prototype.buffer_complete = function() {
    this.loader.off('loaded');
    this.loader.off('buffer:update', this.update_buffer);
    if (this.options.type === 'video') {
      if (this.mode.playing === false && this.options.autoplay && this.loader.percent_loaded >= this.options.buffer_percent) {
        this.mode.play(this.loader.data.duration);
      }
    }
    return this.emit('loaded');
  };

  Vimage.prototype.play = function() {
    return this.mode.play();
  };

  return Vimage;

})();

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/vimage.coffee","/")
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInZpbWFnZS5jb2ZmZWUiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbInZhciBTZXF1ZW5jZUxvYWRlciwgU2VxdWVuY2VQbGF5ZXIsIFV0aWxzLCBWaW1hZ2UsIGhhcHBlbnMsXG4gIGJpbmQgPSBmdW5jdGlvbihmbiwgbWUpeyByZXR1cm4gZnVuY3Rpb24oKXsgcmV0dXJuIGZuLmFwcGx5KG1lLCBhcmd1bWVudHMpOyB9OyB9O1xuXG5oYXBwZW5zID0gcmVxdWlyZSgnaGFwcGVucycpO1xuXG5VdGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcblxuU2VxdWVuY2VMb2FkZXIgPSByZXF1aXJlKCcuL2xvYWRlcicpO1xuXG5TZXF1ZW5jZVBsYXllciA9IHJlcXVpcmUoJy4vcGxheWVyJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gd2luZG93LlZpbWFnZSA9IFZpbWFnZSA9IChmdW5jdGlvbigpIHtcbiAgZnVuY3Rpb24gVmltYWdlKG9wdGlvbnMpIHtcbiAgICBpZiAob3B0aW9ucyA9PSBudWxsKSB7XG4gICAgICBvcHRpb25zID0ge307XG4gICAgfVxuICAgIHRoaXMuYnVmZmVyX2NvbXBsZXRlID0gYmluZCh0aGlzLmJ1ZmZlcl9jb21wbGV0ZSwgdGhpcyk7XG4gICAgdGhpcy51cGRhdGVfYnVmZmVyID0gYmluZCh0aGlzLnVwZGF0ZV9idWZmZXIsIHRoaXMpO1xuICAgIHRoaXMuZGF0YV9sb2FkZWQgPSBiaW5kKHRoaXMuZGF0YV9sb2FkZWQsIHRoaXMpO1xuICAgIGhhcHBlbnModGhpcyk7XG4gICAgdGhpcy5vcHRpb25zID0ge1xuICAgICAgJ2VsZW1lbnQnOiBudWxsLFxuICAgICAgJ2F1dG9wbGF5JzogdHJ1ZSxcbiAgICAgICdmdWxsc2NyZWVuJzogZmFsc2UsXG4gICAgICAnYnVmZmVyX3BlcmNlbnQnOiAwLjEsXG4gICAgICAndHlwZSc6ICd2aWRlbydcbiAgICB9O1xuICAgIFV0aWxzLm1lcmdlKHRoaXMub3B0aW9ucywgb3B0aW9ucyk7XG4gICAgdGhpcy5vcHRpb25zLmVsZW1lbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCh0aGlzLm9wdGlvbnMuZWxlbWVudCk7XG4gICAgdGhpcy5wbGF5ZXIgPSBuZXcgU2VxdWVuY2VQbGF5ZXIodGhpcy5vcHRpb25zLmVsZW1lbnQpO1xuICAgIHRoaXMubW9kZXMgPSByZXF1aXJlKCcuL21vZGVzJyk7XG4gICAgdGhpcy5sb2FkZXIgPSBuZXcgU2VxdWVuY2VMb2FkZXI7XG4gIH1cblxuICBWaW1hZ2UucHJvdG90eXBlLmxvYWQgPSBmdW5jdGlvbihmaWxlKSB7XG4gICAgdGhpcy5sb2FkZXIub24oJ2J1ZmZlcjp1cGRhdGUnLCB0aGlzLnVwZGF0ZV9idWZmZXIpO1xuICAgIHRoaXMubG9hZGVyLm9uY2UoJ2J1ZmZlcjpjb21wbGV0ZScsIHRoaXMuYnVmZmVyX2NvbXBsZXRlKTtcbiAgICB0aGlzLmxvYWRlci5vbmNlKCdkYXRhOmxvYWRlZCcsIHRoaXMuZGF0YV9sb2FkZWQpO1xuICAgIHJldHVybiB0aGlzLmxvYWRlci5sb2FkKGZpbGUpO1xuICB9O1xuXG4gIFZpbWFnZS5wcm90b3R5cGUuc2V0X21vZGUgPSBmdW5jdGlvbihtb2RlKSB7XG4gICAgdGhpcy5tb2RlID0gbW9kZTtcbiAgICByZXR1cm4gdGhpcy5wbGF5ZXIuc2V0X21vZGUodGhpcy5tb2RlKTtcbiAgfTtcblxuICBWaW1hZ2UucHJvdG90eXBlLmRhdGFfbG9hZGVkID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5wbGF5ZXIuZnJhbWVfd2lkdGggPSB0aGlzLmxvYWRlci5kYXRhLndpZHRoO1xuICAgIHRoaXMucGxheWVyLmZyYW1lX2hlaWdodCA9IHRoaXMubG9hZGVyLmRhdGEuaGVpZ2h0O1xuICAgIHRoaXMucGxheWVyLnNldF9zaXplKHRoaXMubG9hZGVyLmRhdGEud2lkdGgsIHRoaXMubG9hZGVyLmRhdGEuaGVpZ2h0KTtcbiAgICBpZiAodGhpcy5vcHRpb25zLmZ1bGxzY3JlZW4pIHtcbiAgICAgIHRoaXMucGxheWVyLmVuYWJsZV9mdWxsc2NyZWVuX3Jlc2l6ZSgpO1xuICAgIH1cblxuICAgIC8qXG4gICAgXHRcdFBsYXkgdGhlIG1vZGUgYWZ0ZXIgdGhlIGZpcnN0IHBhY2tzIGhhdmUgbG9hZGVkXG4gICAgICovXG4gICAgcmV0dXJuIHRoaXMubW9kZS50b3RhbF9mcmFtZXMgPSB0aGlzLmxvYWRlci5kYXRhLnRvdGFsX2ZyYW1lcztcbiAgfTtcblxuXG4gIC8qXG4gIFx0VXBkYXRlIHRoZSBpbWFnZXMgYnVmZmVyXG4gICAqL1xuXG4gIFZpbWFnZS5wcm90b3R5cGUudXBkYXRlX2J1ZmZlciA9IGZ1bmN0aW9uKGltYWdlcykge1xuICAgIHRoaXMucGxheWVyLnVwZGF0ZV9idWZmZXIoaW1hZ2VzKTtcbiAgICBpZiAodGhpcy5vcHRpb25zLnR5cGUgPT09ICd2aWRlbycpIHtcbiAgICAgIGlmICh0aGlzLm1vZGUucGxheWluZyA9PT0gZmFsc2UgJiYgdGhpcy5vcHRpb25zLmF1dG9wbGF5ICYmIHRoaXMubG9hZGVyLnBlcmNlbnRfbG9hZGVkID49IHRoaXMub3B0aW9ucy5idWZmZXJfcGVyY2VudCkge1xuICAgICAgICB0aGlzLm1vZGUucGxheSh0aGlzLmxvYWRlci5kYXRhLmR1cmF0aW9uKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLm1vZGUucGF1c2UpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubW9kZS5yZXN1bWUoKTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cblxuICAvKlxuICBcdEFmdGVyIGFsbCB0aGUgcGFja3MgaGF2ZSBsb2FkZWRcbiAgICovXG5cbiAgVmltYWdlLnByb3RvdHlwZS5idWZmZXJfY29tcGxldGUgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmxvYWRlci5vZmYoJ2xvYWRlZCcpO1xuICAgIHRoaXMubG9hZGVyLm9mZignYnVmZmVyOnVwZGF0ZScsIHRoaXMudXBkYXRlX2J1ZmZlcik7XG4gICAgaWYgKHRoaXMub3B0aW9ucy50eXBlID09PSAndmlkZW8nKSB7XG4gICAgICBpZiAodGhpcy5tb2RlLnBsYXlpbmcgPT09IGZhbHNlICYmIHRoaXMub3B0aW9ucy5hdXRvcGxheSAmJiB0aGlzLmxvYWRlci5wZXJjZW50X2xvYWRlZCA+PSB0aGlzLm9wdGlvbnMuYnVmZmVyX3BlcmNlbnQpIHtcbiAgICAgICAgdGhpcy5tb2RlLnBsYXkodGhpcy5sb2FkZXIuZGF0YS5kdXJhdGlvbik7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmVtaXQoJ2xvYWRlZCcpO1xuICB9O1xuXG4gIFZpbWFnZS5wcm90b3R5cGUucGxheSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLm1vZGUucGxheSgpO1xuICB9O1xuXG4gIHJldHVybiBWaW1hZ2U7XG5cbn0pKCk7XG4iXX0=
},{"./loader":7,"./modes":13,"./player":14,"./utils":15,"_process":5,"buffer":1,"happens":6}]},{},[16])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2d1bHAtY29mZmVlaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvZ3VscC1jb2ZmZWVpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIuLi9ub2RlX21vZHVsZXMvZ3VscC1jb2ZmZWVpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaWVlZTc1NC9pbmRleC5qcyIsIi4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheS9pbmRleC5qcyIsIi4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2hhcHBlbnMvaW5kZXguanMiLCJsb2FkZXIuY29mZmVlIiwibG9hZGluZy9hc3luY19sb2FkZXIuY29mZmVlIiwibG9hZGluZy9iaW5hcnlfbG9hZGVyLmNvZmZlZSIsImxvYWRpbmcvZGF0YV9sb2FkZXIuY29mZmVlIiwibG9hZGluZy9zeW5jX2xvYWRlci5jb2ZmZWUiLCJsb2cuY29mZmVlIiwibW9kZXMuY29mZmVlIiwicGxheWVyLmNvZmZlZSIsInV0aWxzLmNvZmZlZSIsInZpbWFnZS5jb2ZmZWUiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMTdDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9IQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4vKiFcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXMtYXJyYXknKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gU2xvd0J1ZmZlclxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwXG5CdWZmZXIucG9vbFNpemUgPSA4MTkyIC8vIG5vdCB1c2VkIGJ5IHRoaXMgaW1wbGVtZW50YXRpb25cblxudmFyIHJvb3RQYXJlbnQgPSB7fVxuXG4vKipcbiAqIElmIGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGA6XG4gKiAgID09PSB0cnVlICAgIFVzZSBVaW50OEFycmF5IGltcGxlbWVudGF0aW9uIChmYXN0ZXN0KVxuICogICA9PT0gZmFsc2UgICBVc2UgT2JqZWN0IGltcGxlbWVudGF0aW9uIChtb3N0IGNvbXBhdGlibGUsIGV2ZW4gSUU2KVxuICpcbiAqIEJyb3dzZXJzIHRoYXQgc3VwcG9ydCB0eXBlZCBhcnJheXMgYXJlIElFIDEwKywgRmlyZWZveCA0KywgQ2hyb21lIDcrLCBTYWZhcmkgNS4xKyxcbiAqIE9wZXJhIDExLjYrLCBpT1MgNC4yKy5cbiAqXG4gKiBEdWUgdG8gdmFyaW91cyBicm93c2VyIGJ1Z3MsIHNvbWV0aW1lcyB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uIHdpbGwgYmUgdXNlZCBldmVuXG4gKiB3aGVuIHRoZSBicm93c2VyIHN1cHBvcnRzIHR5cGVkIGFycmF5cy5cbiAqXG4gKiBOb3RlOlxuICpcbiAqICAgLSBGaXJlZm94IDQtMjkgbGFja3Mgc3VwcG9ydCBmb3IgYWRkaW5nIG5ldyBwcm9wZXJ0aWVzIHRvIGBVaW50OEFycmF5YCBpbnN0YW5jZXMsXG4gKiAgICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogICAtIFNhZmFyaSA1LTcgbGFja3Mgc3VwcG9ydCBmb3IgY2hhbmdpbmcgdGhlIGBPYmplY3QucHJvdG90eXBlLmNvbnN0cnVjdG9yYCBwcm9wZXJ0eVxuICogICAgIG9uIG9iamVjdHMuXG4gKlxuICogICAtIENocm9tZSA5LTEwIGlzIG1pc3NpbmcgdGhlIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24uXG4gKlxuICogICAtIElFMTAgaGFzIGEgYnJva2VuIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyBhcnJheXMgb2ZcbiAqICAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cblxuICogV2UgZGV0ZWN0IHRoZXNlIGJ1Z2d5IGJyb3dzZXJzIGFuZCBzZXQgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYCB0byBgZmFsc2VgIHNvIHRoZXlcbiAqIGdldCB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uLCB3aGljaCBpcyBzbG93ZXIgYnV0IGJlaGF2ZXMgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IChmdW5jdGlvbiAoKSB7XG4gIGZ1bmN0aW9uIEJhciAoKSB7fVxuICB0cnkge1xuICAgIHZhciBhcnIgPSBuZXcgVWludDhBcnJheSgxKVxuICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgYXJyLmNvbnN0cnVjdG9yID0gQmFyXG4gICAgcmV0dXJuIGFyci5mb28oKSA9PT0gNDIgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgYXJyLmNvbnN0cnVjdG9yID09PSBCYXIgJiYgLy8gY29uc3RydWN0b3IgY2FuIGJlIHNldFxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nICYmIC8vIGNocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICAgICAgICBhcnIuc3ViYXJyYXkoMSwgMSkuYnl0ZUxlbmd0aCA9PT0gMCAvLyBpZTEwIGhhcyBicm9rZW4gYHN1YmFycmF5YFxuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn0pKClcblxuZnVuY3Rpb24ga01heExlbmd0aCAoKSB7XG4gIHJldHVybiBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVFxuICAgID8gMHg3ZmZmZmZmZlxuICAgIDogMHgzZmZmZmZmZlxufVxuXG4vKipcbiAqIENsYXNzOiBCdWZmZXJcbiAqID09PT09PT09PT09PT1cbiAqXG4gKiBUaGUgQnVmZmVyIGNvbnN0cnVjdG9yIHJldHVybnMgaW5zdGFuY2VzIG9mIGBVaW50OEFycmF5YCB0aGF0IGFyZSBhdWdtZW50ZWRcbiAqIHdpdGggZnVuY3Rpb24gcHJvcGVydGllcyBmb3IgYWxsIHRoZSBub2RlIGBCdWZmZXJgIEFQSSBmdW5jdGlvbnMuIFdlIHVzZVxuICogYFVpbnQ4QXJyYXlgIHNvIHRoYXQgc3F1YXJlIGJyYWNrZXQgbm90YXRpb24gd29ya3MgYXMgZXhwZWN0ZWQgLS0gaXQgcmV0dXJuc1xuICogYSBzaW5nbGUgb2N0ZXQuXG4gKlxuICogQnkgYXVnbWVudGluZyB0aGUgaW5zdGFuY2VzLCB3ZSBjYW4gYXZvaWQgbW9kaWZ5aW5nIHRoZSBgVWludDhBcnJheWBcbiAqIHByb3RvdHlwZS5cbiAqL1xuZnVuY3Rpb24gQnVmZmVyIChhcmcpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEJ1ZmZlcikpIHtcbiAgICAvLyBBdm9pZCBnb2luZyB0aHJvdWdoIGFuIEFyZ3VtZW50c0FkYXB0b3JUcmFtcG9saW5lIGluIHRoZSBjb21tb24gY2FzZS5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHJldHVybiBuZXcgQnVmZmVyKGFyZywgYXJndW1lbnRzWzFdKVxuICAgIHJldHVybiBuZXcgQnVmZmVyKGFyZylcbiAgfVxuXG4gIHRoaXMubGVuZ3RoID0gMFxuICB0aGlzLnBhcmVudCA9IHVuZGVmaW5lZFxuXG4gIC8vIENvbW1vbiBjYXNlLlxuICBpZiAodHlwZW9mIGFyZyA9PT0gJ251bWJlcicpIHtcbiAgICByZXR1cm4gZnJvbU51bWJlcih0aGlzLCBhcmcpXG4gIH1cblxuICAvLyBTbGlnaHRseSBsZXNzIGNvbW1vbiBjYXNlLlxuICBpZiAodHlwZW9mIGFyZyA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gZnJvbVN0cmluZyh0aGlzLCBhcmcsIGFyZ3VtZW50cy5sZW5ndGggPiAxID8gYXJndW1lbnRzWzFdIDogJ3V0ZjgnKVxuICB9XG5cbiAgLy8gVW51c3VhbC5cbiAgcmV0dXJuIGZyb21PYmplY3QodGhpcywgYXJnKVxufVxuXG5mdW5jdGlvbiBmcm9tTnVtYmVyICh0aGF0LCBsZW5ndGgpIHtcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aCA8IDAgPyAwIDogY2hlY2tlZChsZW5ndGgpIHwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHRoYXRbaV0gPSAwXG4gICAgfVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21TdHJpbmcgKHRoYXQsIHN0cmluZywgZW5jb2RpbmcpIHtcbiAgaWYgKHR5cGVvZiBlbmNvZGluZyAhPT0gJ3N0cmluZycgfHwgZW5jb2RpbmcgPT09ICcnKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIC8vIEFzc3VtcHRpb246IGJ5dGVMZW5ndGgoKSByZXR1cm4gdmFsdWUgaXMgYWx3YXlzIDwga01heExlbmd0aC5cbiAgdmFyIGxlbmd0aCA9IGJ5dGVMZW5ndGgoc3RyaW5nLCBlbmNvZGluZykgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG5cbiAgdGhhdC53cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tT2JqZWN0ICh0aGF0LCBvYmplY3QpIHtcbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihvYmplY3QpKSByZXR1cm4gZnJvbUJ1ZmZlcih0aGF0LCBvYmplY3QpXG5cbiAgaWYgKGlzQXJyYXkob2JqZWN0KSkgcmV0dXJuIGZyb21BcnJheSh0aGF0LCBvYmplY3QpXG5cbiAgaWYgKG9iamVjdCA9PSBudWxsKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbXVzdCBzdGFydCB3aXRoIG51bWJlciwgYnVmZmVyLCBhcnJheSBvciBzdHJpbmcnKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAob2JqZWN0LmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB7XG4gICAgICByZXR1cm4gZnJvbVR5cGVkQXJyYXkodGhhdCwgb2JqZWN0KVxuICAgIH1cbiAgICBpZiAob2JqZWN0IGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICAgIHJldHVybiBmcm9tQXJyYXlCdWZmZXIodGhhdCwgb2JqZWN0KVxuICAgIH1cbiAgfVxuXG4gIGlmIChvYmplY3QubGVuZ3RoKSByZXR1cm4gZnJvbUFycmF5TGlrZSh0aGF0LCBvYmplY3QpXG5cbiAgcmV0dXJuIGZyb21Kc29uT2JqZWN0KHRoYXQsIG9iamVjdClcbn1cblxuZnVuY3Rpb24gZnJvbUJ1ZmZlciAodGhhdCwgYnVmZmVyKSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGJ1ZmZlci5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBidWZmZXIuY29weSh0aGF0LCAwLCAwLCBsZW5ndGgpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIER1cGxpY2F0ZSBvZiBmcm9tQXJyYXkoKSB0byBrZWVwIGZyb21BcnJheSgpIG1vbm9tb3JwaGljLlxuZnVuY3Rpb24gZnJvbVR5cGVkQXJyYXkgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIC8vIFRydW5jYXRpbmcgdGhlIGVsZW1lbnRzIGlzIHByb2JhYmx5IG5vdCB3aGF0IHBlb3BsZSBleHBlY3QgZnJvbSB0eXBlZFxuICAvLyBhcnJheXMgd2l0aCBCWVRFU19QRVJfRUxFTUVOVCA+IDEgYnV0IGl0J3MgY29tcGF0aWJsZSB3aXRoIHRoZSBiZWhhdmlvclxuICAvLyBvZiB0aGUgb2xkIEJ1ZmZlciBjb25zdHJ1Y3Rvci5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheUJ1ZmZlciAodGhhdCwgYXJyYXkpIHtcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UsIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgYXJyYXkuYnl0ZUxlbmd0aFxuICAgIHRoYXQgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkoYXJyYXkpKVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gYW4gb2JqZWN0IGluc3RhbmNlIG9mIHRoZSBCdWZmZXIgY2xhc3NcbiAgICB0aGF0ID0gZnJvbVR5cGVkQXJyYXkodGhhdCwgbmV3IFVpbnQ4QXJyYXkoYXJyYXkpKVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheUxpa2UgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG4vLyBEZXNlcmlhbGl6ZSB7IHR5cGU6ICdCdWZmZXInLCBkYXRhOiBbMSwyLDMsLi4uXSB9IGludG8gYSBCdWZmZXIgb2JqZWN0LlxuLy8gUmV0dXJucyBhIHplcm8tbGVuZ3RoIGJ1ZmZlciBmb3IgaW5wdXRzIHRoYXQgZG9uJ3QgY29uZm9ybSB0byB0aGUgc3BlYy5cbmZ1bmN0aW9uIGZyb21Kc29uT2JqZWN0ICh0aGF0LCBvYmplY3QpIHtcbiAgdmFyIGFycmF5XG4gIHZhciBsZW5ndGggPSAwXG5cbiAgaWYgKG9iamVjdC50eXBlID09PSAnQnVmZmVyJyAmJiBpc0FycmF5KG9iamVjdC5kYXRhKSkge1xuICAgIGFycmF5ID0gb2JqZWN0LmRhdGFcbiAgICBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIH1cbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gYWxsb2NhdGUgKHRoYXQsIGxlbmd0aCkge1xuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSwgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICB0aGF0ID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGxlbmd0aCkpXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBhbiBvYmplY3QgaW5zdGFuY2Ugb2YgdGhlIEJ1ZmZlciBjbGFzc1xuICAgIHRoYXQubGVuZ3RoID0gbGVuZ3RoXG4gICAgdGhhdC5faXNCdWZmZXIgPSB0cnVlXG4gIH1cblxuICB2YXIgZnJvbVBvb2wgPSBsZW5ndGggIT09IDAgJiYgbGVuZ3RoIDw9IEJ1ZmZlci5wb29sU2l6ZSA+Pj4gMVxuICBpZiAoZnJvbVBvb2wpIHRoYXQucGFyZW50ID0gcm9vdFBhcmVudFxuXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGNoZWNrZWQgKGxlbmd0aCkge1xuICAvLyBOb3RlOiBjYW5ub3QgdXNlIGBsZW5ndGggPCBrTWF4TGVuZ3RoYCBoZXJlIGJlY2F1c2UgdGhhdCBmYWlscyB3aGVuXG4gIC8vIGxlbmd0aCBpcyBOYU4gKHdoaWNoIGlzIG90aGVyd2lzZSBjb2VyY2VkIHRvIHplcm8uKVxuICBpZiAobGVuZ3RoID49IGtNYXhMZW5ndGgoKSkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdBdHRlbXB0IHRvIGFsbG9jYXRlIEJ1ZmZlciBsYXJnZXIgdGhhbiBtYXhpbXVtICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICdzaXplOiAweCcgKyBrTWF4TGVuZ3RoKCkudG9TdHJpbmcoMTYpICsgJyBieXRlcycpXG4gIH1cbiAgcmV0dXJuIGxlbmd0aCB8IDBcbn1cblxuZnVuY3Rpb24gU2xvd0J1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFNsb3dCdWZmZXIpKSByZXR1cm4gbmV3IFNsb3dCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG4gIGRlbGV0ZSBidWYucGFyZW50XG4gIHJldHVybiBidWZcbn1cblxuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gaXNCdWZmZXIgKGIpIHtcbiAgcmV0dXJuICEhKGIgIT0gbnVsbCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChhLCBiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGEpIHx8ICFCdWZmZXIuaXNCdWZmZXIoYikpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgbXVzdCBiZSBCdWZmZXJzJylcbiAgfVxuXG4gIGlmIChhID09PSBiKSByZXR1cm4gMFxuXG4gIHZhciB4ID0gYS5sZW5ndGhcbiAgdmFyIHkgPSBiLmxlbmd0aFxuXG4gIHZhciBpID0gMFxuICB2YXIgbGVuID0gTWF0aC5taW4oeCwgeSlcbiAgd2hpbGUgKGkgPCBsZW4pIHtcbiAgICBpZiAoYVtpXSAhPT0gYltpXSkgYnJlYWtcblxuICAgICsraVxuICB9XG5cbiAgaWYgKGkgIT09IGxlbikge1xuICAgIHggPSBhW2ldXG4gICAgeSA9IGJbaV1cbiAgfVxuXG4gIGlmICh4IDwgeSkgcmV0dXJuIC0xXG4gIGlmICh5IDwgeCkgcmV0dXJuIDFcbiAgcmV0dXJuIDBcbn1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiBpc0VuY29kaW5nIChlbmNvZGluZykge1xuICBzd2l0Y2ggKFN0cmluZyhlbmNvZGluZykudG9Mb3dlckNhc2UoKSkge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgY2FzZSAncmF3JzpcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0dXJuIHRydWVcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuQnVmZmVyLmNvbmNhdCA9IGZ1bmN0aW9uIGNvbmNhdCAobGlzdCwgbGVuZ3RoKSB7XG4gIGlmICghaXNBcnJheShsaXN0KSkgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdCBhcmd1bWVudCBtdXN0IGJlIGFuIEFycmF5IG9mIEJ1ZmZlcnMuJylcblxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcigwKVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgbGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihsZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHN0cmluZyA9ICcnICsgc3RyaW5nXG5cbiAgdmFyIGxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKGxlbiA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBVc2UgYSBmb3IgbG9vcCB0byBhdm9pZCByZWN1cnNpb25cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAvLyBEZXByZWNhdGVkXG4gICAgICBjYXNlICdyYXcnOlxuICAgICAgY2FzZSAncmF3cyc6XG4gICAgICAgIHJldHVybiBsZW5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiBsZW4gKiAyXG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gbGVuID4+PiAxXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGggLy8gYXNzdW1lIHV0ZjhcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aFxuXG4vLyBwcmUtc2V0IGZvciB2YWx1ZXMgdGhhdCBtYXkgZXhpc3QgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS5sZW5ndGggPSB1bmRlZmluZWRcbkJ1ZmZlci5wcm90b3R5cGUucGFyZW50ID0gdW5kZWZpbmVkXG5cbmZ1bmN0aW9uIHNsb3dUb1N0cmluZyAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcblxuICBzdGFydCA9IHN0YXJ0IHwgMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgfCAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKGVuY29kaW5nICsgJycpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiB0b1N0cmluZyAoKSB7XG4gIHZhciBsZW5ndGggPSB0aGlzLmxlbmd0aCB8IDBcbiAgaWYgKGxlbmd0aCA9PT0gMCkgcmV0dXJuICcnXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHNsb3dUb1N0cmluZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gZXF1YWxzIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiB0cnVlXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0ICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHtcbiAgICBzdHIgPSB0aGlzLnRvU3RyaW5nKCdoZXgnLCAwLCBtYXgpLm1hdGNoKC8uezJ9L2cpLmpvaW4oJyAnKVxuICAgIGlmICh0aGlzLmxlbmd0aCA+IG1heCkgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiAwXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluZGV4T2YgPSBmdW5jdGlvbiBpbmRleE9mICh2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgaWYgKGJ5dGVPZmZzZXQgPiAweDdmZmZmZmZmKSBieXRlT2Zmc2V0ID0gMHg3ZmZmZmZmZlxuICBlbHNlIGlmIChieXRlT2Zmc2V0IDwgLTB4ODAwMDAwMDApIGJ5dGVPZmZzZXQgPSAtMHg4MDAwMDAwMFxuICBieXRlT2Zmc2V0ID4+PSAwXG5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gLTFcbiAgaWYgKGJ5dGVPZmZzZXQgPj0gdGhpcy5sZW5ndGgpIHJldHVybiAtMVxuXG4gIC8vIE5lZ2F0aXZlIG9mZnNldHMgc3RhcnQgZnJvbSB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwKSBieXRlT2Zmc2V0ID0gTWF0aC5tYXgodGhpcy5sZW5ndGggKyBieXRlT2Zmc2V0LCAwKVxuXG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIGlmICh2YWwubGVuZ3RoID09PSAwKSByZXR1cm4gLTEgLy8gc3BlY2lhbCBjYXNlOiBsb29raW5nIGZvciBlbXB0eSBzdHJpbmcgYWx3YXlzIGZhaWxzXG4gICAgcmV0dXJuIFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHZhbCkpIHtcbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ251bWJlcicpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gICAgfVxuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgWyB2YWwgXSwgYnl0ZU9mZnNldClcbiAgfVxuXG4gIGZ1bmN0aW9uIGFycmF5SW5kZXhPZiAoYXJyLCB2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgICB2YXIgZm91bmRJbmRleCA9IC0xXG4gICAgZm9yICh2YXIgaSA9IDA7IGJ5dGVPZmZzZXQgKyBpIDwgYXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYXJyW2J5dGVPZmZzZXQgKyBpXSA9PT0gdmFsW2ZvdW5kSW5kZXggPT09IC0xID8gMCA6IGkgLSBmb3VuZEluZGV4XSkge1xuICAgICAgICBpZiAoZm91bmRJbmRleCA9PT0gLTEpIGZvdW5kSW5kZXggPSBpXG4gICAgICAgIGlmIChpIC0gZm91bmRJbmRleCArIDEgPT09IHZhbC5sZW5ndGgpIHJldHVybiBieXRlT2Zmc2V0ICsgZm91bmRJbmRleFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm91bmRJbmRleCA9IC0xXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAtMVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsIG11c3QgYmUgc3RyaW5nLCBudW1iZXIgb3IgQnVmZmVyJylcbn1cblxuLy8gYGdldGAgaXMgZGVwcmVjYXRlZFxuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiBnZXQgKG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLmdldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMucmVhZFVJbnQ4KG9mZnNldClcbn1cblxuLy8gYHNldGAgaXMgZGVwcmVjYXRlZFxuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiBzZXQgKHYsIG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLnNldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMud3JpdGVVSW50OCh2LCBvZmZzZXQpXG59XG5cbmZ1bmN0aW9uIGhleFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgb2Zmc2V0ID0gTnVtYmVyKG9mZnNldCkgfHwgMFxuICB2YXIgcmVtYWluaW5nID0gYnVmLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG5cbiAgLy8gbXVzdCBiZSBhbiBldmVuIG51bWJlciBvZiBkaWdpdHNcbiAgdmFyIHN0ckxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKHN0ckxlbiAlIDIgIT09IDApIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcblxuICBpZiAobGVuZ3RoID4gc3RyTGVuIC8gMikge1xuICAgIGxlbmd0aCA9IHN0ckxlbiAvIDJcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnNlZCA9IHBhcnNlSW50KHN0cmluZy5zdWJzdHIoaSAqIDIsIDIpLCAxNilcbiAgICBpZiAoaXNOYU4ocGFyc2VkKSkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IHBhcnNlZFxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIHV0ZjhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjhUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGFzY2lpV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmluYXJ5V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJhc2U2NFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiB1Y3MyV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcih1dGYxNmxlVG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gd3JpdGUgKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcpXG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCkge1xuICAgIGVuY29kaW5nID0gJ3V0ZjgnXG4gICAgbGVuZ3RoID0gdGhpcy5sZW5ndGhcbiAgICBvZmZzZXQgPSAwXG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvZmZzZXQgPT09ICdzdHJpbmcnKSB7XG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgb2Zmc2V0WywgbGVuZ3RoXVssIGVuY29kaW5nXSlcbiAgfSBlbHNlIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICAgIGlmIChpc0Zpbml0ZShsZW5ndGgpKSB7XG4gICAgICBsZW5ndGggPSBsZW5ndGggfCAwXG4gICAgICBpZiAoZW5jb2RpbmcgPT09IHVuZGVmaW5lZCkgZW5jb2RpbmcgPSAndXRmOCdcbiAgICB9IGVsc2Uge1xuICAgICAgZW5jb2RpbmcgPSBsZW5ndGhcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZFxuICAgIH1cbiAgLy8gbGVnYWN5IHdyaXRlKHN0cmluZywgZW5jb2RpbmcsIG9mZnNldCwgbGVuZ3RoKSAtIHJlbW92ZSBpbiB2MC4xM1xuICB9IGVsc2Uge1xuICAgIHZhciBzd2FwID0gZW5jb2RpbmdcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIG9mZnNldCA9IGxlbmd0aCB8IDBcbiAgICBsZW5ndGggPSBzd2FwXG4gIH1cblxuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkIHx8IGxlbmd0aCA+IHJlbWFpbmluZykgbGVuZ3RoID0gcmVtYWluaW5nXG5cbiAgaWYgKChzdHJpbmcubGVuZ3RoID4gMCAmJiAobGVuZ3RoIDwgMCB8fCBvZmZzZXQgPCAwKSkgfHwgb2Zmc2V0ID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignYXR0ZW1wdCB0byB3cml0ZSBvdXRzaWRlIGJ1ZmZlciBib3VuZHMnKVxuICB9XG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcblxuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuICBmb3IgKDs7KSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGJpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIC8vIFdhcm5pbmc6IG1heExlbmd0aCBub3QgdGFrZW4gaW50byBhY2NvdW50IGluIGJhc2U2NFdyaXRlXG4gICAgICAgIHJldHVybiBiYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdWNzMldyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9ICgnJyArIGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIHRvSlNPTiAoKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ0J1ZmZlcicsXG4gICAgZGF0YTogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5fYXJyIHx8IHRoaXMsIDApXG4gIH1cbn1cblxuZnVuY3Rpb24gYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHV0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXMgPSAnJ1xuICB2YXIgdG1wID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgaWYgKGJ1ZltpXSA8PSAweDdGKSB7XG4gICAgICByZXMgKz0gZGVjb2RlVXRmOENoYXIodG1wKSArIFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICAgICAgdG1wID0gJydcbiAgICB9IGVsc2Uge1xuICAgICAgdG1wICs9ICclJyArIGJ1ZltpXS50b1N0cmluZygxNilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzICsgZGVjb2RlVXRmOENoYXIodG1wKVxufVxuXG5mdW5jdGlvbiBhc2NpaVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSAmIDB4N0YpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBiaW5hcnlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBoZXhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCB8fCBlbmQgPCAwIHx8IGVuZCA+IGxlbikgZW5kID0gbGVuXG5cbiAgdmFyIG91dCA9ICcnXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBieXRlcyA9IGJ1Zi5zbGljZShzdGFydCwgZW5kKVxuICB2YXIgcmVzID0gJydcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHJlcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldICsgYnl0ZXNbaSArIDFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIHNsaWNlIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IH5+c3RhcnRcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyBsZW4gOiB+fmVuZFxuXG4gIGlmIChzdGFydCA8IDApIHtcbiAgICBzdGFydCArPSBsZW5cbiAgICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgfSBlbHNlIGlmIChzdGFydCA+IGxlbikge1xuICAgIHN0YXJ0ID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgMCkge1xuICAgIGVuZCArPSBsZW5cbiAgICBpZiAoZW5kIDwgMCkgZW5kID0gMFxuICB9IGVsc2UgaWYgKGVuZCA+IGxlbikge1xuICAgIGVuZCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIHZhciBuZXdCdWZcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgbmV3QnVmID0gQnVmZmVyLl9hdWdtZW50KHRoaXMuc3ViYXJyYXkoc3RhcnQsIGVuZCkpXG4gIH0gZWxzZSB7XG4gICAgdmFyIHNsaWNlTGVuID0gZW5kIC0gc3RhcnRcbiAgICBuZXdCdWYgPSBuZXcgQnVmZmVyKHNsaWNlTGVuLCB1bmRlZmluZWQpXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzbGljZUxlbjsgaSsrKSB7XG4gICAgICBuZXdCdWZbaV0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH1cblxuICBpZiAobmV3QnVmLmxlbmd0aCkgbmV3QnVmLnBhcmVudCA9IHRoaXMucGFyZW50IHx8IHRoaXNcblxuICByZXR1cm4gbmV3QnVmXG59XG5cbi8qXG4gKiBOZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IGJ1ZmZlciBpc24ndCB0cnlpbmcgdG8gd3JpdGUgb3V0IG9mIGJvdW5kcy5cbiAqL1xuZnVuY3Rpb24gY2hlY2tPZmZzZXQgKG9mZnNldCwgZXh0LCBsZW5ndGgpIHtcbiAgaWYgKChvZmZzZXQgJSAxKSAhPT0gMCB8fCBvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignb2Zmc2V0IGlzIG5vdCB1aW50JylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1RyeWluZyB0byBhY2Nlc3MgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50TEUgPSBmdW5jdGlvbiByZWFkVUludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50QkUgPSBmdW5jdGlvbiByZWFkVUludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuICB9XG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXVxuICB2YXIgbXVsID0gMVxuICB3aGlsZSAoYnl0ZUxlbmd0aCA+IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQ4ID0gZnVuY3Rpb24gcmVhZFVJbnQ4IChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2TEUgPSBmdW5jdGlvbiByZWFkVUludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkJFID0gZnVuY3Rpb24gcmVhZFVJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDgpIHwgdGhpc1tvZmZzZXQgKyAxXVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAoKHRoaXNbb2Zmc2V0XSkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpKSArXG4gICAgICAodGhpc1tvZmZzZXQgKyAzXSAqIDB4MTAwMDAwMClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkUgPSBmdW5jdGlvbiByZWFkVUludDMyQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSAqIDB4MTAwMDAwMCkgK1xuICAgICgodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICB0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRMRSA9IGZ1bmN0aW9uIHJlYWRJbnRMRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcbiAgfVxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKSB2YWwgLT0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpXG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRCRSA9IGZ1bmN0aW9uIHJlYWRJbnRCRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aFxuICB2YXIgbXVsID0gMVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWldXG4gIHdoaWxlIChpID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0taV0gKiBtdWxcbiAgfVxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKSB2YWwgLT0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpXG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQ4ID0gZnVuY3Rpb24gcmVhZEludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgaWYgKCEodGhpc1tvZmZzZXRdICYgMHg4MCkpIHJldHVybiAodGhpc1tvZmZzZXRdKVxuICByZXR1cm4gKCgweGZmIC0gdGhpc1tvZmZzZXRdICsgMSkgKiAtMSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2QkUgPSBmdW5jdGlvbiByZWFkSW50MTZCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAxXSB8ICh0aGlzW29mZnNldF0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkxFID0gZnVuY3Rpb24gcmVhZEludDMyTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSkgfFxuICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDNdIDw8IDI0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24gcmVhZEludDMyQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCAyNCkgfFxuICAgICh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFID0gZnVuY3Rpb24gcmVhZEZsb2F0TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdEJFID0gZnVuY3Rpb24gcmVhZEZsb2F0QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEUgPSBmdW5jdGlvbiByZWFkRG91YmxlTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDUyLCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVCRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDUyLCA4KVxufVxuXG5mdW5jdGlvbiBjaGVja0ludCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGJ1ZikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2J1ZmZlciBtdXN0IGJlIGEgQnVmZmVyIGluc3RhbmNlJylcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnRMRSA9IGZ1bmN0aW9uIHdyaXRlVUludExFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlVUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gd3JpdGVVSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweGZmLCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB2YWx1ZSA9IE1hdGguZmxvb3IodmFsdWUpXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDE2IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDIpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlICYgKDB4ZmYgPDwgKDggKiAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSkpKSA+Pj5cbiAgICAgIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpICogOFxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2QkUgPSBmdW5jdGlvbiB3cml0ZVVJbnQxNkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCA0KTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSA+Pj4gKGxpdHRsZUVuZGlhbiA/IGkgOiAzIC0gaSkgKiA4KSAmIDB4ZmZcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZVVJbnQzMkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRMRSA9IGZ1bmN0aW9uIHdyaXRlSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSAwXG4gIHZhciBtdWwgPSAxXG4gIHZhciBzdWIgPSB2YWx1ZSA8IDAgPyAxIDogMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50QkUgPSBmdW5jdGlvbiB3cml0ZUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICgodmFsdWUgLyBtdWwpID4+IDApIC0gc3ViICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiB3cml0ZUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHg3ZiwgLTB4ODApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmICsgdmFsdWUgKyAxXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVJbnQxNkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2QkUgPSBmdW5jdGlvbiB3cml0ZUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVJbnQzMkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbmZ1bmN0aW9uIGNoZWNrSUVFRTc1NCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG4gIGlmIChvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuZnVuY3Rpb24gd3JpdGVGbG9hdCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA0LCAzLjQwMjgyMzQ2NjM4NTI4ODZlKzM4LCAtMy40MDI4MjM0NjYzODUyODg2ZSszOClcbiAgfVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCAyMywgNClcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0TEUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRCRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiB3cml0ZURvdWJsZSAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA4LCAxLjc5NzY5MzEzNDg2MjMxNTdFKzMwOCwgLTEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDUyLCA4KVxuICByZXR1cm4gb2Zmc2V0ICsgOFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlTEUgPSBmdW5jdGlvbiB3cml0ZURvdWJsZUxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVCRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbi8vIGNvcHkodGFyZ2V0QnVmZmVyLCB0YXJnZXRTdGFydD0wLCBzb3VyY2VTdGFydD0wLCBzb3VyY2VFbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uIGNvcHkgKHRhcmdldCwgdGFyZ2V0U3RhcnQsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kICYmIGVuZCAhPT0gMCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldFN0YXJ0ID49IHRhcmdldC5sZW5ndGgpIHRhcmdldFN0YXJ0ID0gdGFyZ2V0Lmxlbmd0aFxuICBpZiAoIXRhcmdldFN0YXJ0KSB0YXJnZXRTdGFydCA9IDBcbiAgaWYgKGVuZCA+IDAgJiYgZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm4gMFxuICBpZiAodGFyZ2V0Lmxlbmd0aCA9PT0gMCB8fCB0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBGYXRhbCBlcnJvciBjb25kaXRpb25zXG4gIGlmICh0YXJnZXRTdGFydCA8IDApIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIH1cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZVN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZUVuZCBvdXQgb2YgYm91bmRzJylcblxuICAvLyBBcmUgd2Ugb29iP1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0U3RhcnQgPCBlbmQgLSBzdGFydCkge1xuICAgIGVuZCA9IHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCArIHN0YXJ0XG4gIH1cblxuICB2YXIgbGVuID0gZW5kIC0gc3RhcnRcbiAgdmFyIGlcblxuICBpZiAodGhpcyA9PT0gdGFyZ2V0ICYmIHN0YXJ0IDwgdGFyZ2V0U3RhcnQgJiYgdGFyZ2V0U3RhcnQgPCBlbmQpIHtcbiAgICAvLyBkZXNjZW5kaW5nIGNvcHkgZnJvbSBlbmRcbiAgICBmb3IgKGkgPSBsZW4gLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgdGFyZ2V0W2kgKyB0YXJnZXRTdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH0gZWxzZSBpZiAobGVuIDwgMTAwMCB8fCAhQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBhc2NlbmRpbmcgY29weSBmcm9tIHN0YXJ0XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB0YXJnZXRbaSArIHRhcmdldFN0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0YXJnZXQuX3NldCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBzdGFydCArIGxlbiksIHRhcmdldFN0YXJ0KVxuICB9XG5cbiAgcmV0dXJuIGxlblxufVxuXG4vLyBmaWxsKHZhbHVlLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuZmlsbCA9IGZ1bmN0aW9uIGZpbGwgKHZhbHVlLCBzdGFydCwgZW5kKSB7XG4gIGlmICghdmFsdWUpIHZhbHVlID0gMFxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQpIGVuZCA9IHRoaXMubGVuZ3RoXG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIDwgc3RhcnQnKVxuXG4gIC8vIEZpbGwgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3N0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCB8fCBlbmQgPiB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2VuZCBvdXQgb2YgYm91bmRzJylcblxuICB2YXIgaVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSB2YWx1ZVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB2YXIgYnl0ZXMgPSB1dGY4VG9CeXRlcyh2YWx1ZS50b1N0cmluZygpKVxuICAgIHZhciBsZW4gPSBieXRlcy5sZW5ndGhcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gYnl0ZXNbaSAlIGxlbl1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpc1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgYEFycmF5QnVmZmVyYCB3aXRoIHRoZSAqY29waWVkKiBtZW1vcnkgb2YgdGhlIGJ1ZmZlciBpbnN0YW5jZS5cbiAqIEFkZGVkIGluIE5vZGUgMC4xMi4gT25seSBhdmFpbGFibGUgaW4gYnJvd3NlcnMgdGhhdCBzdXBwb3J0IEFycmF5QnVmZmVyLlxuICovXG5CdWZmZXIucHJvdG90eXBlLnRvQXJyYXlCdWZmZXIgPSBmdW5jdGlvbiB0b0FycmF5QnVmZmVyICgpIHtcbiAgaWYgKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgICAgcmV0dXJuIChuZXcgQnVmZmVyKHRoaXMpKS5idWZmZXJcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGJ1ZiA9IG5ldyBVaW50OEFycmF5KHRoaXMubGVuZ3RoKVxuICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGJ1Zi5sZW5ndGg7IGkgPCBsZW47IGkgKz0gMSkge1xuICAgICAgICBidWZbaV0gPSB0aGlzW2ldXG4gICAgICB9XG4gICAgICByZXR1cm4gYnVmLmJ1ZmZlclxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdCdWZmZXIudG9BcnJheUJ1ZmZlciBub3Qgc3VwcG9ydGVkIGluIHRoaXMgYnJvd3NlcicpXG4gIH1cbn1cblxuLy8gSEVMUEVSIEZVTkNUSU9OU1xuLy8gPT09PT09PT09PT09PT09PVxuXG52YXIgQlAgPSBCdWZmZXIucHJvdG90eXBlXG5cbi8qKlxuICogQXVnbWVudCBhIFVpbnQ4QXJyYXkgKmluc3RhbmNlKiAobm90IHRoZSBVaW50OEFycmF5IGNsYXNzISkgd2l0aCBCdWZmZXIgbWV0aG9kc1xuICovXG5CdWZmZXIuX2F1Z21lbnQgPSBmdW5jdGlvbiBfYXVnbWVudCAoYXJyKSB7XG4gIGFyci5jb25zdHJ1Y3RvciA9IEJ1ZmZlclxuICBhcnIuX2lzQnVmZmVyID0gdHJ1ZVxuXG4gIC8vIHNhdmUgcmVmZXJlbmNlIHRvIG9yaWdpbmFsIFVpbnQ4QXJyYXkgc2V0IG1ldGhvZCBiZWZvcmUgb3ZlcndyaXRpbmdcbiAgYXJyLl9zZXQgPSBhcnIuc2V0XG5cbiAgLy8gZGVwcmVjYXRlZFxuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5pbmRleE9mID0gQlAuaW5kZXhPZlxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50TEUgPSBCUC5yZWFkVUludExFXG4gIGFyci5yZWFkVUludEJFID0gQlAucmVhZFVJbnRCRVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnRMRSA9IEJQLnJlYWRJbnRMRVxuICBhcnIucmVhZEludEJFID0gQlAucmVhZEludEJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludExFID0gQlAud3JpdGVVSW50TEVcbiAgYXJyLndyaXRlVUludEJFID0gQlAud3JpdGVVSW50QkVcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludExFID0gQlAud3JpdGVJbnRMRVxuICBhcnIud3JpdGVJbnRCRSA9IEJQLndyaXRlSW50QkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS1aYS16LV9dL2dcblxuZnVuY3Rpb24gYmFzZTY0Y2xlYW4gKHN0cikge1xuICAvLyBOb2RlIHN0cmlwcyBvdXQgaW52YWxpZCBjaGFyYWN0ZXJzIGxpa2UgXFxuIGFuZCBcXHQgZnJvbSB0aGUgc3RyaW5nLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgc3RyID0gc3RyaW5ndHJpbShzdHIpLnJlcGxhY2UoSU5WQUxJRF9CQVNFNjRfUkUsICcnKVxuICAvLyBOb2RlIGNvbnZlcnRzIHN0cmluZ3Mgd2l0aCBsZW5ndGggPCAyIHRvICcnXG4gIGlmIChzdHIubGVuZ3RoIDwgMikgcmV0dXJuICcnXG4gIC8vIE5vZGUgYWxsb3dzIGZvciBub24tcGFkZGVkIGJhc2U2NCBzdHJpbmdzIChtaXNzaW5nIHRyYWlsaW5nID09PSksIGJhc2U2NC1qcyBkb2VzIG5vdFxuICB3aGlsZSAoc3RyLmxlbmd0aCAlIDQgIT09IDApIHtcbiAgICBzdHIgPSBzdHIgKyAnPSdcbiAgfVxuICByZXR1cm4gc3RyXG59XG5cbmZ1bmN0aW9uIHN0cmluZ3RyaW0gKHN0cikge1xuICBpZiAoc3RyLnRyaW0pIHJldHVybiBzdHIudHJpbSgpXG4gIHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXG59XG5cbmZ1bmN0aW9uIHRvSGV4IChuKSB7XG4gIGlmIChuIDwgMTYpIHJldHVybiAnMCcgKyBuLnRvU3RyaW5nKDE2KVxuICByZXR1cm4gbi50b1N0cmluZygxNilcbn1cblxuZnVuY3Rpb24gdXRmOFRvQnl0ZXMgKHN0cmluZywgdW5pdHMpIHtcbiAgdW5pdHMgPSB1bml0cyB8fCBJbmZpbml0eVxuICB2YXIgY29kZVBvaW50XG4gIHZhciBsZW5ndGggPSBzdHJpbmcubGVuZ3RoXG4gIHZhciBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICB2YXIgYnl0ZXMgPSBbXVxuICB2YXIgaSA9IDBcblxuICBmb3IgKDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgY29kZVBvaW50ID0gc3RyaW5nLmNoYXJDb2RlQXQoaSlcblxuICAgIC8vIGlzIHN1cnJvZ2F0ZSBjb21wb25lbnRcbiAgICBpZiAoY29kZVBvaW50ID4gMHhEN0ZGICYmIGNvZGVQb2ludCA8IDB4RTAwMCkge1xuICAgICAgLy8gbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmIChsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAgIC8vIDIgbGVhZHMgaW4gYSByb3dcbiAgICAgICAgaWYgKGNvZGVQb2ludCA8IDB4REMwMCkge1xuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHZhbGlkIHN1cnJvZ2F0ZSBwYWlyXG4gICAgICAgICAgY29kZVBvaW50ID0gbGVhZFN1cnJvZ2F0ZSAtIDB4RDgwMCA8PCAxMCB8IGNvZGVQb2ludCAtIDB4REMwMCB8IDB4MTAwMDBcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBubyBsZWFkIHlldFxuXG4gICAgICAgIGlmIChjb2RlUG9pbnQgPiAweERCRkYpIHtcbiAgICAgICAgICAvLyB1bmV4cGVjdGVkIHRyYWlsXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIGlmIChpICsgMSA9PT0gbGVuZ3RoKSB7XG4gICAgICAgICAgLy8gdW5wYWlyZWQgbGVhZFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gdmFsaWQgbGVhZFxuICAgICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAvLyB2YWxpZCBibXAgY2hhciwgYnV0IGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gICAgfVxuXG4gICAgLy8gZW5jb2RlIHV0ZjhcbiAgICBpZiAoY29kZVBvaW50IDwgMHg4MCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAxKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKGNvZGVQb2ludClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4ODAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgfCAweEMwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgxMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAzKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDIHwgMHhFMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgyMDAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gNCkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4MTIgfCAweEYwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGNvZGUgcG9pbnQnKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBieXRlc1xufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSAmIDB4RkYpXG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiB1dGYxNmxlVG9CeXRlcyAoc3RyLCB1bml0cykge1xuICB2YXIgYywgaGksIGxvXG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuXG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyAoc3RyKSB7XG4gIHJldHVybiBiYXNlNjQudG9CeXRlQXJyYXkoYmFzZTY0Y2xlYW4oc3RyKSlcbn1cblxuZnVuY3Rpb24gYmxpdEJ1ZmZlciAoc3JjLCBkc3QsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKGkgKyBvZmZzZXQgPj0gZHN0Lmxlbmd0aCkgfHwgKGkgPj0gc3JjLmxlbmd0aCkpIGJyZWFrXG4gICAgZHN0W2kgKyBvZmZzZXRdID0gc3JjW2ldXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gZGVjb2RlVXRmOENoYXIgKHN0cikge1xuICB0cnkge1xuICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoc3RyKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZSgweEZGRkQpIC8vIFVURiA4IGludmFsaWQgY2hhclxuICB9XG59XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKCdfcHJvY2VzcycpLHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWwgOiB0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL2luZGV4LmpzXCIsXCIvLi4vbm9kZV9tb2R1bGVzL2d1bHAtY29mZmVlaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXJcIilcbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWRhdGE6YXBwbGljYXRpb24vanNvbjtjaGFyc2V0OnV0Zi04O2Jhc2U2NCxleUoyWlhKemFXOXVJam96TENKemIzVnlZMlZ6SWpwYklpNHVMMjV2WkdWZmJXOWtkV3hsY3k5bmRXeHdMV052Wm1abFpXbG1lUzl1YjJSbFgyMXZaSFZzWlhNdlluSnZkM05sY21sbWVTOXViMlJsWDIxdlpIVnNaWE12WW5WbVptVnlMMmx1WkdWNExtcHpJbDBzSW01aGJXVnpJanBiWFN3aWJXRndjR2x1WjNNaU9pSTdRVUZCUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEVpTENKbWFXeGxJam9pWjJWdVpYSmhkR1ZrTG1weklpd2ljMjkxY21ObFVtOXZkQ0k2SWlJc0luTnZkWEpqWlhORGIyNTBaVzUwSWpwYklpOHFJVnh1SUNvZ1ZHaGxJR0oxWm1abGNpQnRiMlIxYkdVZ1puSnZiU0J1YjJSbExtcHpMQ0JtYjNJZ2RHaGxJR0p5YjNkelpYSXVYRzRnS2x4dUlDb2dRR0YxZEdodmNpQWdJRVpsY205emN5QkJZbTkxYTJoaFpHbHFaV2dnUEdabGNtOXpjMEJtWlhKdmMzTXViM0puUGlBOGFIUjBjRG92TDJabGNtOXpjeTV2Y21jK1hHNGdLaUJBYkdsalpXNXpaU0FnVFVsVVhHNGdLaTljYmx4dWRtRnlJR0poYzJVMk5DQTlJSEpsY1hWcGNtVW9KMkpoYzJVMk5DMXFjeWNwWEc1MllYSWdhV1ZsWlRjMU5DQTlJSEpsY1hWcGNtVW9KMmxsWldVM05UUW5LVnh1ZG1GeUlHbHpRWEp5WVhrZ1BTQnlaWEYxYVhKbEtDZHBjeTFoY25KaGVTY3BYRzVjYm1WNGNHOXlkSE11UW5WbVptVnlJRDBnUW5WbVptVnlYRzVsZUhCdmNuUnpMbE5zYjNkQ2RXWm1aWElnUFNCVGJHOTNRblZtWm1WeVhHNWxlSEJ2Y25SekxrbE9VMUJGUTFSZlRVRllYMEpaVkVWVElEMGdOVEJjYmtKMVptWmxjaTV3YjI5c1UybDZaU0E5SURneE9USWdMeThnYm05MElIVnpaV1FnWW5rZ2RHaHBjeUJwYlhCc1pXMWxiblJoZEdsdmJseHVYRzUyWVhJZ2NtOXZkRkJoY21WdWRDQTlJSHQ5WEc1Y2JpOHFLbHh1SUNvZ1NXWWdZRUoxWm1abGNpNVVXVkJGUkY5QlVsSkJXVjlUVlZCUVQxSlVZRHBjYmlBcUlDQWdQVDA5SUhSeWRXVWdJQ0FnVlhObElGVnBiblE0UVhKeVlYa2dhVzF3YkdWdFpXNTBZWFJwYjI0Z0tHWmhjM1JsYzNRcFhHNGdLaUFnSUQwOVBTQm1ZV3h6WlNBZ0lGVnpaU0JQWW1wbFkzUWdhVzF3YkdWdFpXNTBZWFJwYjI0Z0tHMXZjM1FnWTI5dGNHRjBhV0pzWlN3Z1pYWmxiaUJKUlRZcFhHNGdLbHh1SUNvZ1FuSnZkM05sY25NZ2RHaGhkQ0J6ZFhCd2IzSjBJSFI1Y0dWa0lHRnljbUY1Y3lCaGNtVWdTVVVnTVRBckxDQkdhWEpsWm05NElEUXJMQ0JEYUhKdmJXVWdOeXNzSUZOaFptRnlhU0ExTGpFckxGeHVJQ29nVDNCbGNtRWdNVEV1Tmlzc0lHbFBVeUEwTGpJckxseHVJQ3BjYmlBcUlFUjFaU0IwYnlCMllYSnBiM1Z6SUdKeWIzZHpaWElnWW5WbmN5d2djMjl0WlhScGJXVnpJSFJvWlNCUFltcGxZM1FnYVcxd2JHVnRaVzUwWVhScGIyNGdkMmxzYkNCaVpTQjFjMlZrSUdWMlpXNWNiaUFxSUhkb1pXNGdkR2hsSUdKeWIzZHpaWElnYzNWd2NHOXlkSE1nZEhsd1pXUWdZWEp5WVhsekxseHVJQ3BjYmlBcUlFNXZkR1U2WEc0Z0tseHVJQ29nSUNBdElFWnBjbVZtYjNnZ05DMHlPU0JzWVdOcmN5QnpkWEJ3YjNKMElHWnZjaUJoWkdScGJtY2dibVYzSUhCeWIzQmxjblJwWlhNZ2RHOGdZRlZwYm5RNFFYSnlZWGxnSUdsdWMzUmhibU5sY3l4Y2JpQXFJQ0FnSUNCVFpXVTZJR2gwZEhCek9pOHZZblZuZW1sc2JHRXViVzk2YVd4c1lTNXZjbWN2YzJodmQxOWlkV2N1WTJkcFAybGtQVFk1TlRRek9DNWNiaUFxWEc0Z0tpQWdJQzBnVTJGbVlYSnBJRFV0TnlCc1lXTnJjeUJ6ZFhCd2IzSjBJR1p2Y2lCamFHRnVaMmx1WnlCMGFHVWdZRTlpYW1WamRDNXdjbTkwYjNSNWNHVXVZMjl1YzNSeWRXTjBiM0pnSUhCeWIzQmxjblI1WEc0Z0tpQWdJQ0FnYjI0Z2IySnFaV04wY3k1Y2JpQXFYRzRnS2lBZ0lDMGdRMmh5YjIxbElEa3RNVEFnYVhNZ2JXbHpjMmx1WnlCMGFHVWdZRlI1Y0dWa1FYSnlZWGt1Y0hKdmRHOTBlWEJsTG5OMVltRnljbUY1WUNCbWRXNWpkR2x2Ymk1Y2JpQXFYRzRnS2lBZ0lDMGdTVVV4TUNCb1lYTWdZU0JpY205clpXNGdZRlI1Y0dWa1FYSnlZWGt1Y0hKdmRHOTBlWEJsTG5OMVltRnljbUY1WUNCbWRXNWpkR2x2YmlCM2FHbGphQ0J5WlhSMWNtNXpJR0Z5Y21GNWN5QnZabHh1SUNvZ0lDQWdJR2x1WTI5eWNtVmpkQ0JzWlc1bmRHZ2dhVzRnYzI5dFpTQnphWFIxWVhScGIyNXpMbHh1WEc0Z0tpQlhaU0JrWlhSbFkzUWdkR2hsYzJVZ1luVm5aM2tnWW5KdmQzTmxjbk1nWVc1a0lITmxkQ0JnUW5WbVptVnlMbFJaVUVWRVgwRlNVa0ZaWDFOVlVGQlBVbFJnSUhSdklHQm1ZV3h6WldBZ2MyOGdkR2hsZVZ4dUlDb2daMlYwSUhSb1pTQlBZbXBsWTNRZ2FXMXdiR1Z0Wlc1MFlYUnBiMjRzSUhkb2FXTm9JR2x6SUhOc2IzZGxjaUJpZFhRZ1ltVm9ZWFpsY3lCamIzSnlaV04wYkhrdVhHNGdLaTljYmtKMVptWmxjaTVVV1ZCRlJGOUJVbEpCV1Y5VFZWQlFUMUpVSUQwZ0tHWjFibU4wYVc5dUlDZ3BJSHRjYmlBZ1puVnVZM1JwYjI0Z1FtRnlJQ2dwSUh0OVhHNGdJSFJ5ZVNCN1hHNGdJQ0FnZG1GeUlHRnljaUE5SUc1bGR5QlZhVzUwT0VGeWNtRjVLREVwWEc0Z0lDQWdZWEp5TG1admJ5QTlJR1oxYm1OMGFXOXVJQ2dwSUhzZ2NtVjBkWEp1SURReUlIMWNiaUFnSUNCaGNuSXVZMjl1YzNSeWRXTjBiM0lnUFNCQ1lYSmNiaUFnSUNCeVpYUjFjbTRnWVhKeUxtWnZieWdwSUQwOVBTQTBNaUFtSmlBdkx5QjBlWEJsWkNCaGNuSmhlU0JwYm5OMFlXNWpaWE1nWTJGdUlHSmxJR0YxWjIxbGJuUmxaRnh1SUNBZ0lDQWdJQ0JoY25JdVkyOXVjM1J5ZFdOMGIzSWdQVDA5SUVKaGNpQW1KaUF2THlCamIyNXpkSEoxWTNSdmNpQmpZVzRnWW1VZ2MyVjBYRzRnSUNBZ0lDQWdJSFI1Y0dWdlppQmhjbkl1YzNWaVlYSnlZWGtnUFQwOUlDZG1kVzVqZEdsdmJpY2dKaVlnTHk4Z1kyaHliMjFsSURrdE1UQWdiR0ZqYXlCZ2MzVmlZWEp5WVhsZ1hHNGdJQ0FnSUNBZ0lHRnljaTV6ZFdKaGNuSmhlU2d4TENBeEtTNWllWFJsVEdWdVozUm9JRDA5UFNBd0lDOHZJR2xsTVRBZ2FHRnpJR0p5YjJ0bGJpQmdjM1ZpWVhKeVlYbGdYRzRnSUgwZ1kyRjBZMmdnS0dVcElIdGNiaUFnSUNCeVpYUjFjbTRnWm1Gc2MyVmNiaUFnZlZ4dWZTa29LVnh1WEc1bWRXNWpkR2x2YmlCclRXRjRUR1Z1WjNSb0lDZ3BJSHRjYmlBZ2NtVjBkWEp1SUVKMVptWmxjaTVVV1ZCRlJGOUJVbEpCV1Y5VFZWQlFUMUpVWEc0Z0lDQWdQeUF3ZURkbVptWm1abVptWEc0Z0lDQWdPaUF3ZURObVptWm1abVptWEc1OVhHNWNiaThxS2x4dUlDb2dRMnhoYzNNNklFSjFabVpsY2x4dUlDb2dQVDA5UFQwOVBUMDlQVDA5UFZ4dUlDcGNiaUFxSUZSb1pTQkNkV1ptWlhJZ1kyOXVjM1J5ZFdOMGIzSWdjbVYwZFhKdWN5QnBibk4wWVc1alpYTWdiMllnWUZWcGJuUTRRWEp5WVhsZ0lIUm9ZWFFnWVhKbElHRjFaMjFsYm5SbFpGeHVJQ29nZDJsMGFDQm1kVzVqZEdsdmJpQndjbTl3WlhKMGFXVnpJR1p2Y2lCaGJHd2dkR2hsSUc1dlpHVWdZRUoxWm1abGNtQWdRVkJKSUdaMWJtTjBhVzl1Y3k0Z1YyVWdkWE5sWEc0Z0tpQmdWV2x1ZERoQmNuSmhlV0FnYzI4Z2RHaGhkQ0J6Y1hWaGNtVWdZbkpoWTJ0bGRDQnViM1JoZEdsdmJpQjNiM0pyY3lCaGN5QmxlSEJsWTNSbFpDQXRMU0JwZENCeVpYUjFjbTV6WEc0Z0tpQmhJSE5wYm1kc1pTQnZZM1JsZEM1Y2JpQXFYRzRnS2lCQ2VTQmhkV2R0Wlc1MGFXNW5JSFJvWlNCcGJuTjBZVzVqWlhNc0lIZGxJR05oYmlCaGRtOXBaQ0J0YjJScFpubHBibWNnZEdobElHQlZhVzUwT0VGeWNtRjVZRnh1SUNvZ2NISnZkRzkwZVhCbExseHVJQ292WEc1bWRXNWpkR2x2YmlCQ2RXWm1aWElnS0dGeVp5a2dlMXh1SUNCcFppQW9JU2gwYUdseklHbHVjM1JoYm1ObGIyWWdRblZtWm1WeUtTa2dlMXh1SUNBZ0lDOHZJRUYyYjJsa0lHZHZhVzVuSUhSb2NtOTFaMmdnWVc0Z1FYSm5kVzFsYm5SelFXUmhjSFJ2Y2xSeVlXMXdiMnhwYm1VZ2FXNGdkR2hsSUdOdmJXMXZiaUJqWVhObExseHVJQ0FnSUdsbUlDaGhjbWQxYldWdWRITXViR1Z1WjNSb0lENGdNU2tnY21WMGRYSnVJRzVsZHlCQ2RXWm1aWElvWVhKbkxDQmhjbWQxYldWdWRITmJNVjBwWEc0Z0lDQWdjbVYwZFhKdUlHNWxkeUJDZFdabVpYSW9ZWEpuS1Z4dUlDQjlYRzVjYmlBZ2RHaHBjeTVzWlc1bmRHZ2dQU0F3WEc0Z0lIUm9hWE11Y0dGeVpXNTBJRDBnZFc1a1pXWnBibVZrWEc1Y2JpQWdMeThnUTI5dGJXOXVJR05oYzJVdVhHNGdJR2xtSUNoMGVYQmxiMllnWVhKbklEMDlQU0FuYm5WdFltVnlKeWtnZTF4dUlDQWdJSEpsZEhWeWJpQm1jbTl0VG5WdFltVnlLSFJvYVhNc0lHRnlaeWxjYmlBZ2ZWeHVYRzRnSUM4dklGTnNhV2RvZEd4NUlHeGxjM01nWTI5dGJXOXVJR05oYzJVdVhHNGdJR2xtSUNoMGVYQmxiMllnWVhKbklEMDlQU0FuYzNSeWFXNW5KeWtnZTF4dUlDQWdJSEpsZEhWeWJpQm1jbTl0VTNSeWFXNW5LSFJvYVhNc0lHRnlaeXdnWVhKbmRXMWxiblJ6TG14bGJtZDBhQ0ErSURFZ1B5QmhjbWQxYldWdWRITmJNVjBnT2lBbmRYUm1PQ2NwWEc0Z0lIMWNibHh1SUNBdkx5QlZiblZ6ZFdGc0xseHVJQ0J5WlhSMWNtNGdabkp2YlU5aWFtVmpkQ2gwYUdsekxDQmhjbWNwWEc1OVhHNWNibVoxYm1OMGFXOXVJR1p5YjIxT2RXMWlaWElnS0hSb1lYUXNJR3hsYm1kMGFDa2dlMXh1SUNCMGFHRjBJRDBnWVd4c2IyTmhkR1VvZEdoaGRDd2diR1Z1WjNSb0lEd2dNQ0EvSURBZ09pQmphR1ZqYTJWa0tHeGxibWQwYUNrZ2ZDQXdLVnh1SUNCcFppQW9JVUoxWm1abGNpNVVXVkJGUkY5QlVsSkJXVjlUVlZCUVQxSlVLU0I3WEc0Z0lDQWdabTl5SUNoMllYSWdhU0E5SURBN0lHa2dQQ0JzWlc1bmRHZzdJR2tyS3lrZ2UxeHVJQ0FnSUNBZ2RHaGhkRnRwWFNBOUlEQmNiaUFnSUNCOVhHNGdJSDFjYmlBZ2NtVjBkWEp1SUhSb1lYUmNibjFjYmx4dVpuVnVZM1JwYjI0Z1puSnZiVk4wY21sdVp5QW9kR2hoZEN3Z2MzUnlhVzVuTENCbGJtTnZaR2x1WnlrZ2UxeHVJQ0JwWmlBb2RIbHdaVzltSUdWdVkyOWthVzVuSUNFOVBTQW5jM1J5YVc1bkp5QjhmQ0JsYm1OdlpHbHVaeUE5UFQwZ0p5Y3BJR1Z1WTI5a2FXNW5JRDBnSjNWMFpqZ25YRzVjYmlBZ0x5OGdRWE56ZFcxd2RHbHZiam9nWW5sMFpVeGxibWQwYUNncElISmxkSFZ5YmlCMllXeDFaU0JwY3lCaGJIZGhlWE1nUENCclRXRjRUR1Z1WjNSb0xseHVJQ0IyWVhJZ2JHVnVaM1JvSUQwZ1lubDBaVXhsYm1kMGFDaHpkSEpwYm1jc0lHVnVZMjlrYVc1bktTQjhJREJjYmlBZ2RHaGhkQ0E5SUdGc2JHOWpZWFJsS0hSb1lYUXNJR3hsYm1kMGFDbGNibHh1SUNCMGFHRjBMbmR5YVhSbEtITjBjbWx1Wnl3Z1pXNWpiMlJwYm1jcFhHNGdJSEpsZEhWeWJpQjBhR0YwWEc1OVhHNWNibVoxYm1OMGFXOXVJR1p5YjIxUFltcGxZM1FnS0hSb1lYUXNJRzlpYW1WamRDa2dlMXh1SUNCcFppQW9RblZtWm1WeUxtbHpRblZtWm1WeUtHOWlhbVZqZENrcElISmxkSFZ5YmlCbWNtOXRRblZtWm1WeUtIUm9ZWFFzSUc5aWFtVmpkQ2xjYmx4dUlDQnBaaUFvYVhOQmNuSmhlU2h2WW1wbFkzUXBLU0J5WlhSMWNtNGdabkp2YlVGeWNtRjVLSFJvWVhRc0lHOWlhbVZqZENsY2JseHVJQ0JwWmlBb2IySnFaV04wSUQwOUlHNTFiR3dwSUh0Y2JpQWdJQ0IwYUhKdmR5QnVaWGNnVkhsd1pVVnljbTl5S0NkdGRYTjBJSE4wWVhKMElIZHBkR2dnYm5WdFltVnlMQ0JpZFdabVpYSXNJR0Z5Y21GNUlHOXlJSE4wY21sdVp5Y3BYRzRnSUgxY2JseHVJQ0JwWmlBb2RIbHdaVzltSUVGeWNtRjVRblZtWm1WeUlDRTlQU0FuZFc1a1pXWnBibVZrSnlrZ2UxeHVJQ0FnSUdsbUlDaHZZbXBsWTNRdVluVm1abVZ5SUdsdWMzUmhibU5sYjJZZ1FYSnlZWGxDZFdabVpYSXBJSHRjYmlBZ0lDQWdJSEpsZEhWeWJpQm1jbTl0Vkhsd1pXUkJjbkpoZVNoMGFHRjBMQ0J2WW1wbFkzUXBYRzRnSUNBZ2ZWeHVJQ0FnSUdsbUlDaHZZbXBsWTNRZ2FXNXpkR0Z1WTJWdlppQkJjbkpoZVVKMVptWmxjaWtnZTF4dUlDQWdJQ0FnY21WMGRYSnVJR1p5YjIxQmNuSmhlVUoxWm1abGNpaDBhR0YwTENCdlltcGxZM1FwWEc0Z0lDQWdmVnh1SUNCOVhHNWNiaUFnYVdZZ0tHOWlhbVZqZEM1c1pXNW5kR2dwSUhKbGRIVnliaUJtY205dFFYSnlZWGxNYVd0bEtIUm9ZWFFzSUc5aWFtVmpkQ2xjYmx4dUlDQnlaWFIxY200Z1puSnZiVXB6YjI1UFltcGxZM1FvZEdoaGRDd2diMkpxWldOMEtWeHVmVnh1WEc1bWRXNWpkR2x2YmlCbWNtOXRRblZtWm1WeUlDaDBhR0YwTENCaWRXWm1aWElwSUh0Y2JpQWdkbUZ5SUd4bGJtZDBhQ0E5SUdOb1pXTnJaV1FvWW5WbVptVnlMbXhsYm1kMGFDa2dmQ0F3WEc0Z0lIUm9ZWFFnUFNCaGJHeHZZMkYwWlNoMGFHRjBMQ0JzWlc1bmRHZ3BYRzRnSUdKMVptWmxjaTVqYjNCNUtIUm9ZWFFzSURBc0lEQXNJR3hsYm1kMGFDbGNiaUFnY21WMGRYSnVJSFJvWVhSY2JuMWNibHh1Wm5WdVkzUnBiMjRnWm5KdmJVRnljbUY1SUNoMGFHRjBMQ0JoY25KaGVTa2dlMXh1SUNCMllYSWdiR1Z1WjNSb0lEMGdZMmhsWTJ0bFpDaGhjbkpoZVM1c1pXNW5kR2dwSUh3Z01GeHVJQ0IwYUdGMElEMGdZV3hzYjJOaGRHVW9kR2hoZEN3Z2JHVnVaM1JvS1Z4dUlDQm1iM0lnS0haaGNpQnBJRDBnTURzZ2FTQThJR3hsYm1kMGFEc2dhU0FyUFNBeEtTQjdYRzRnSUNBZ2RHaGhkRnRwWFNBOUlHRnljbUY1VzJsZElDWWdNalUxWEc0Z0lIMWNiaUFnY21WMGRYSnVJSFJvWVhSY2JuMWNibHh1THk4Z1JIVndiR2xqWVhSbElHOW1JR1p5YjIxQmNuSmhlU2dwSUhSdklHdGxaWEFnWm5KdmJVRnljbUY1S0NrZ2JXOXViMjF2Y25Cb2FXTXVYRzVtZFc1amRHbHZiaUJtY205dFZIbHdaV1JCY25KaGVTQW9kR2hoZEN3Z1lYSnlZWGtwSUh0Y2JpQWdkbUZ5SUd4bGJtZDBhQ0E5SUdOb1pXTnJaV1FvWVhKeVlYa3ViR1Z1WjNSb0tTQjhJREJjYmlBZ2RHaGhkQ0E5SUdGc2JHOWpZWFJsS0hSb1lYUXNJR3hsYm1kMGFDbGNiaUFnTHk4Z1ZISjFibU5oZEdsdVp5QjBhR1VnWld4bGJXVnVkSE1nYVhNZ2NISnZZbUZpYkhrZ2JtOTBJSGRvWVhRZ2NHVnZjR3hsSUdWNGNHVmpkQ0JtY205dElIUjVjR1ZrWEc0Z0lDOHZJR0Z5Y21GNWN5QjNhWFJvSUVKWlZFVlRYMUJGVWw5RlRFVk5SVTVVSUQ0Z01TQmlkWFFnYVhRbmN5QmpiMjF3WVhScFlteGxJSGRwZEdnZ2RHaGxJR0psYUdGMmFXOXlYRzRnSUM4dklHOW1JSFJvWlNCdmJHUWdRblZtWm1WeUlHTnZibk4wY25WamRHOXlMbHh1SUNCbWIzSWdLSFpoY2lCcElEMGdNRHNnYVNBOElHeGxibWQwYURzZ2FTQXJQU0F4S1NCN1hHNGdJQ0FnZEdoaGRGdHBYU0E5SUdGeWNtRjVXMmxkSUNZZ01qVTFYRzRnSUgxY2JpQWdjbVYwZFhKdUlIUm9ZWFJjYm4xY2JseHVablZ1WTNScGIyNGdabkp2YlVGeWNtRjVRblZtWm1WeUlDaDBhR0YwTENCaGNuSmhlU2tnZTF4dUlDQnBaaUFvUW5WbVptVnlMbFJaVUVWRVgwRlNVa0ZaWDFOVlVGQlBVbFFwSUh0Y2JpQWdJQ0F2THlCU1pYUjFjbTRnWVc0Z1lYVm5iV1Z1ZEdWa0lHQlZhVzUwT0VGeWNtRjVZQ0JwYm5OMFlXNWpaU3dnWm05eUlHSmxjM1FnY0dWeVptOXliV0Z1WTJWY2JpQWdJQ0JoY25KaGVTNWllWFJsVEdWdVozUm9YRzRnSUNBZ2RHaGhkQ0E5SUVKMVptWmxjaTVmWVhWbmJXVnVkQ2h1WlhjZ1ZXbHVkRGhCY25KaGVTaGhjbkpoZVNrcFhHNGdJSDBnWld4elpTQjdYRzRnSUNBZ0x5OGdSbUZzYkdKaFkyczZJRkpsZEhWeWJpQmhiaUJ2WW1wbFkzUWdhVzV6ZEdGdVkyVWdiMllnZEdobElFSjFabVpsY2lCamJHRnpjMXh1SUNBZ0lIUm9ZWFFnUFNCbWNtOXRWSGx3WldSQmNuSmhlU2gwYUdGMExDQnVaWGNnVldsdWREaEJjbkpoZVNoaGNuSmhlU2twWEc0Z0lIMWNiaUFnY21WMGRYSnVJSFJvWVhSY2JuMWNibHh1Wm5WdVkzUnBiMjRnWm5KdmJVRnljbUY1VEdsclpTQW9kR2hoZEN3Z1lYSnlZWGtwSUh0Y2JpQWdkbUZ5SUd4bGJtZDBhQ0E5SUdOb1pXTnJaV1FvWVhKeVlYa3ViR1Z1WjNSb0tTQjhJREJjYmlBZ2RHaGhkQ0E5SUdGc2JHOWpZWFJsS0hSb1lYUXNJR3hsYm1kMGFDbGNiaUFnWm05eUlDaDJZWElnYVNBOUlEQTdJR2tnUENCc1pXNW5kR2c3SUdrZ0t6MGdNU2tnZTF4dUlDQWdJSFJvWVhSYmFWMGdQU0JoY25KaGVWdHBYU0FtSURJMU5WeHVJQ0I5WEc0Z0lISmxkSFZ5YmlCMGFHRjBYRzU5WEc1Y2JpOHZJRVJsYzJWeWFXRnNhWHBsSUhzZ2RIbHdaVG9nSjBKMVptWmxjaWNzSUdSaGRHRTZJRnN4TERJc015d3VMaTVkSUgwZ2FXNTBieUJoSUVKMVptWmxjaUJ2WW1wbFkzUXVYRzR2THlCU1pYUjFjbTV6SUdFZ2VtVnlieTFzWlc1bmRHZ2dZblZtWm1WeUlHWnZjaUJwYm5CMWRITWdkR2hoZENCa2IyNG5kQ0JqYjI1bWIzSnRJSFJ2SUhSb1pTQnpjR1ZqTGx4dVpuVnVZM1JwYjI0Z1puSnZiVXB6YjI1UFltcGxZM1FnS0hSb1lYUXNJRzlpYW1WamRDa2dlMXh1SUNCMllYSWdZWEp5WVhsY2JpQWdkbUZ5SUd4bGJtZDBhQ0E5SURCY2JseHVJQ0JwWmlBb2IySnFaV04wTG5SNWNHVWdQVDA5SUNkQ2RXWm1aWEluSUNZbUlHbHpRWEp5WVhrb2IySnFaV04wTG1SaGRHRXBLU0I3WEc0Z0lDQWdZWEp5WVhrZ1BTQnZZbXBsWTNRdVpHRjBZVnh1SUNBZ0lHeGxibWQwYUNBOUlHTm9aV05yWldRb1lYSnlZWGt1YkdWdVozUm9LU0I4SURCY2JpQWdmVnh1SUNCMGFHRjBJRDBnWVd4c2IyTmhkR1VvZEdoaGRDd2diR1Z1WjNSb0tWeHVYRzRnSUdadmNpQW9kbUZ5SUdrZ1BTQXdPeUJwSUR3Z2JHVnVaM1JvT3lCcElDczlJREVwSUh0Y2JpQWdJQ0IwYUdGMFcybGRJRDBnWVhKeVlYbGJhVjBnSmlBeU5UVmNiaUFnZlZ4dUlDQnlaWFIxY200Z2RHaGhkRnh1ZlZ4dVhHNW1kVzVqZEdsdmJpQmhiR3h2WTJGMFpTQW9kR2hoZEN3Z2JHVnVaM1JvS1NCN1hHNGdJR2xtSUNoQ2RXWm1aWEl1VkZsUVJVUmZRVkpTUVZsZlUxVlFVRTlTVkNrZ2UxeHVJQ0FnSUM4dklGSmxkSFZ5YmlCaGJpQmhkV2R0Wlc1MFpXUWdZRlZwYm5RNFFYSnlZWGxnSUdsdWMzUmhibU5sTENCbWIzSWdZbVZ6ZENCd1pYSm1iM0p0WVc1alpWeHVJQ0FnSUhSb1lYUWdQU0JDZFdabVpYSXVYMkYxWjIxbGJuUW9ibVYzSUZWcGJuUTRRWEp5WVhrb2JHVnVaM1JvS1NsY2JpQWdmU0JsYkhObElIdGNiaUFnSUNBdkx5QkdZV3hzWW1GamF6b2dVbVYwZFhKdUlHRnVJRzlpYW1WamRDQnBibk4wWVc1alpTQnZaaUIwYUdVZ1FuVm1abVZ5SUdOc1lYTnpYRzRnSUNBZ2RHaGhkQzVzWlc1bmRHZ2dQU0JzWlc1bmRHaGNiaUFnSUNCMGFHRjBMbDlwYzBKMVptWmxjaUE5SUhSeWRXVmNiaUFnZlZ4dVhHNGdJSFpoY2lCbWNtOXRVRzl2YkNBOUlHeGxibWQwYUNBaFBUMGdNQ0FtSmlCc1pXNW5kR2dnUEQwZ1FuVm1abVZ5TG5CdmIyeFRhWHBsSUQ0K1BpQXhYRzRnSUdsbUlDaG1jbTl0VUc5dmJDa2dkR2hoZEM1d1lYSmxiblFnUFNCeWIyOTBVR0Z5Wlc1MFhHNWNiaUFnY21WMGRYSnVJSFJvWVhSY2JuMWNibHh1Wm5WdVkzUnBiMjRnWTJobFkydGxaQ0FvYkdWdVozUm9LU0I3WEc0Z0lDOHZJRTV2ZEdVNklHTmhibTV2ZENCMWMyVWdZR3hsYm1kMGFDQThJR3ROWVhoTVpXNW5kR2hnSUdobGNtVWdZbVZqWVhWelpTQjBhR0YwSUdaaGFXeHpJSGRvWlc1Y2JpQWdMeThnYkdWdVozUm9JR2x6SUU1aFRpQW9kMmhwWTJnZ2FYTWdiM1JvWlhKM2FYTmxJR052WlhKalpXUWdkRzhnZW1WeWJ5NHBYRzRnSUdsbUlDaHNaVzVuZEdnZ1BqMGdhMDFoZUV4bGJtZDBhQ2dwS1NCN1hHNGdJQ0FnZEdoeWIzY2dibVYzSUZKaGJtZGxSWEp5YjNJb0owRjBkR1Z0Y0hRZ2RHOGdZV3hzYjJOaGRHVWdRblZtWm1WeUlHeGhjbWRsY2lCMGFHRnVJRzFoZUdsdGRXMGdKeUFyWEc0Z0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSjNOcGVtVTZJREI0SnlBcklHdE5ZWGhNWlc1bmRHZ29LUzUwYjFOMGNtbHVaeWd4TmlrZ0t5QW5JR0o1ZEdWekp5bGNiaUFnZlZ4dUlDQnlaWFIxY200Z2JHVnVaM1JvSUh3Z01GeHVmVnh1WEc1bWRXNWpkR2x2YmlCVGJHOTNRblZtWm1WeUlDaHpkV0pxWldOMExDQmxibU52WkdsdVp5a2dlMXh1SUNCcFppQW9JU2gwYUdseklHbHVjM1JoYm1ObGIyWWdVMnh2ZDBKMVptWmxjaWtwSUhKbGRIVnliaUJ1WlhjZ1UyeHZkMEoxWm1abGNpaHpkV0pxWldOMExDQmxibU52WkdsdVp5bGNibHh1SUNCMllYSWdZblZtSUQwZ2JtVjNJRUoxWm1abGNpaHpkV0pxWldOMExDQmxibU52WkdsdVp5bGNiaUFnWkdWc1pYUmxJR0oxWmk1d1lYSmxiblJjYmlBZ2NtVjBkWEp1SUdKMVpseHVmVnh1WEc1Q2RXWm1aWEl1YVhOQ2RXWm1aWElnUFNCbWRXNWpkR2x2YmlCcGMwSjFabVpsY2lBb1lpa2dlMXh1SUNCeVpYUjFjbTRnSVNFb1lpQWhQU0J1ZFd4c0lDWW1JR0l1WDJselFuVm1abVZ5S1Z4dWZWeHVYRzVDZFdabVpYSXVZMjl0Y0dGeVpTQTlJR1oxYm1OMGFXOXVJR052YlhCaGNtVWdLR0VzSUdJcElIdGNiaUFnYVdZZ0tDRkNkV1ptWlhJdWFYTkNkV1ptWlhJb1lTa2dmSHdnSVVKMVptWmxjaTVwYzBKMVptWmxjaWhpS1NrZ2UxeHVJQ0FnSUhSb2NtOTNJRzVsZHlCVWVYQmxSWEp5YjNJb0owRnlaM1Z0Wlc1MGN5QnRkWE4wSUdKbElFSjFabVpsY25NbktWeHVJQ0I5WEc1Y2JpQWdhV1lnS0dFZ1BUMDlJR0lwSUhKbGRIVnliaUF3WEc1Y2JpQWdkbUZ5SUhnZ1BTQmhMbXhsYm1kMGFGeHVJQ0IyWVhJZ2VTQTlJR0l1YkdWdVozUm9YRzVjYmlBZ2RtRnlJR2tnUFNBd1hHNGdJSFpoY2lCc1pXNGdQU0JOWVhSb0xtMXBiaWg0TENCNUtWeHVJQ0IzYUdsc1pTQW9hU0E4SUd4bGJpa2dlMXh1SUNBZ0lHbG1JQ2hoVzJsZElDRTlQU0JpVzJsZEtTQmljbVZoYTF4dVhHNGdJQ0FnS3l0cFhHNGdJSDFjYmx4dUlDQnBaaUFvYVNBaFBUMGdiR1Z1S1NCN1hHNGdJQ0FnZUNBOUlHRmJhVjFjYmlBZ0lDQjVJRDBnWWx0cFhWeHVJQ0I5WEc1Y2JpQWdhV1lnS0hnZ1BDQjVLU0J5WlhSMWNtNGdMVEZjYmlBZ2FXWWdLSGtnUENCNEtTQnlaWFIxY200Z01WeHVJQ0J5WlhSMWNtNGdNRnh1ZlZ4dVhHNUNkV1ptWlhJdWFYTkZibU52WkdsdVp5QTlJR1oxYm1OMGFXOXVJR2x6Ulc1amIyUnBibWNnS0dWdVkyOWthVzVuS1NCN1hHNGdJSE4zYVhSamFDQW9VM1J5YVc1bktHVnVZMjlrYVc1bktTNTBiMHh2ZDJWeVEyRnpaU2dwS1NCN1hHNGdJQ0FnWTJGelpTQW5hR1Y0SnpwY2JpQWdJQ0JqWVhObElDZDFkR1k0SnpwY2JpQWdJQ0JqWVhObElDZDFkR1l0T0NjNlhHNGdJQ0FnWTJGelpTQW5ZWE5qYVdrbk9seHVJQ0FnSUdOaGMyVWdKMkpwYm1GeWVTYzZYRzRnSUNBZ1kyRnpaU0FuWW1GelpUWTBKenBjYmlBZ0lDQmpZWE5sSUNkeVlYY25PbHh1SUNBZ0lHTmhjMlVnSjNWamN6SW5PbHh1SUNBZ0lHTmhjMlVnSjNWamN5MHlKenBjYmlBZ0lDQmpZWE5sSUNkMWRHWXhObXhsSnpwY2JpQWdJQ0JqWVhObElDZDFkR1l0TVRac1pTYzZYRzRnSUNBZ0lDQnlaWFIxY200Z2RISjFaVnh1SUNBZ0lHUmxabUYxYkhRNlhHNGdJQ0FnSUNCeVpYUjFjbTRnWm1Gc2MyVmNiaUFnZlZ4dWZWeHVYRzVDZFdabVpYSXVZMjl1WTJGMElEMGdablZ1WTNScGIyNGdZMjl1WTJGMElDaHNhWE4wTENCc1pXNW5kR2dwSUh0Y2JpQWdhV1lnS0NGcGMwRnljbUY1S0d4cGMzUXBLU0IwYUhKdmR5QnVaWGNnVkhsd1pVVnljbTl5S0Nkc2FYTjBJR0Z5WjNWdFpXNTBJRzExYzNRZ1ltVWdZVzRnUVhKeVlYa2diMllnUW5WbVptVnljeTRuS1Z4dVhHNGdJR2xtSUNoc2FYTjBMbXhsYm1kMGFDQTlQVDBnTUNrZ2UxeHVJQ0FnSUhKbGRIVnliaUJ1WlhjZ1FuVm1abVZ5S0RBcFhHNGdJSDFjYmx4dUlDQjJZWElnYVZ4dUlDQnBaaUFvYkdWdVozUm9JRDA5UFNCMWJtUmxabWx1WldRcElIdGNiaUFnSUNCc1pXNW5kR2dnUFNBd1hHNGdJQ0FnWm05eUlDaHBJRDBnTURzZ2FTQThJR3hwYzNRdWJHVnVaM1JvT3lCcEt5c3BJSHRjYmlBZ0lDQWdJR3hsYm1kMGFDQXJQU0JzYVhOMFcybGRMbXhsYm1kMGFGeHVJQ0FnSUgxY2JpQWdmVnh1WEc0Z0lIWmhjaUJpZFdZZ1BTQnVaWGNnUW5WbVptVnlLR3hsYm1kMGFDbGNiaUFnZG1GeUlIQnZjeUE5SURCY2JpQWdabTl5SUNocElEMGdNRHNnYVNBOElHeHBjM1F1YkdWdVozUm9PeUJwS3lzcElIdGNiaUFnSUNCMllYSWdhWFJsYlNBOUlHeHBjM1JiYVYxY2JpQWdJQ0JwZEdWdExtTnZjSGtvWW5WbUxDQndiM01wWEc0Z0lDQWdjRzl6SUNzOUlHbDBaVzB1YkdWdVozUm9YRzRnSUgxY2JpQWdjbVYwZFhKdUlHSjFabHh1ZlZ4dVhHNW1kVzVqZEdsdmJpQmllWFJsVEdWdVozUm9JQ2h6ZEhKcGJtY3NJR1Z1WTI5a2FXNW5LU0I3WEc0Z0lHbG1JQ2gwZVhCbGIyWWdjM1J5YVc1bklDRTlQU0FuYzNSeWFXNW5KeWtnYzNSeWFXNW5JRDBnSnljZ0t5QnpkSEpwYm1kY2JseHVJQ0IyWVhJZ2JHVnVJRDBnYzNSeWFXNW5MbXhsYm1kMGFGeHVJQ0JwWmlBb2JHVnVJRDA5UFNBd0tTQnlaWFIxY200Z01GeHVYRzRnSUM4dklGVnpaU0JoSUdadmNpQnNiMjl3SUhSdklHRjJiMmxrSUhKbFkzVnljMmx2Ymx4dUlDQjJZWElnYkc5M1pYSmxaRU5oYzJVZ1BTQm1ZV3h6WlZ4dUlDQm1iM0lnS0RzN0tTQjdYRzRnSUNBZ2MzZHBkR05vSUNobGJtTnZaR2x1WnlrZ2UxeHVJQ0FnSUNBZ1kyRnpaU0FuWVhOamFXa25PbHh1SUNBZ0lDQWdZMkZ6WlNBblltbHVZWEo1SnpwY2JpQWdJQ0FnSUM4dklFUmxjSEpsWTJGMFpXUmNiaUFnSUNBZ0lHTmhjMlVnSjNKaGR5YzZYRzRnSUNBZ0lDQmpZWE5sSUNkeVlYZHpKenBjYmlBZ0lDQWdJQ0FnY21WMGRYSnVJR3hsYmx4dUlDQWdJQ0FnWTJGelpTQW5kWFJtT0NjNlhHNGdJQ0FnSUNCallYTmxJQ2QxZEdZdE9DYzZYRzRnSUNBZ0lDQWdJSEpsZEhWeWJpQjFkR1k0Vkc5Q2VYUmxjeWh6ZEhKcGJtY3BMbXhsYm1kMGFGeHVJQ0FnSUNBZ1kyRnpaU0FuZFdOek1pYzZYRzRnSUNBZ0lDQmpZWE5sSUNkMVkzTXRNaWM2WEc0Z0lDQWdJQ0JqWVhObElDZDFkR1l4Tm14bEp6cGNiaUFnSUNBZ0lHTmhjMlVnSjNWMFppMHhObXhsSnpwY2JpQWdJQ0FnSUNBZ2NtVjBkWEp1SUd4bGJpQXFJREpjYmlBZ0lDQWdJR05oYzJVZ0oyaGxlQ2M2WEc0Z0lDQWdJQ0FnSUhKbGRIVnliaUJzWlc0Z1BqNCtJREZjYmlBZ0lDQWdJR05oYzJVZ0oySmhjMlUyTkNjNlhHNGdJQ0FnSUNBZ0lISmxkSFZ5YmlCaVlYTmxOalJVYjBKNWRHVnpLSE4wY21sdVp5a3ViR1Z1WjNSb1hHNGdJQ0FnSUNCa1pXWmhkV3gwT2x4dUlDQWdJQ0FnSUNCcFppQW9iRzkzWlhKbFpFTmhjMlVwSUhKbGRIVnliaUIxZEdZNFZHOUNlWFJsY3loemRISnBibWNwTG14bGJtZDBhQ0F2THlCaGMzTjFiV1VnZFhSbU9GeHVJQ0FnSUNBZ0lDQmxibU52WkdsdVp5QTlJQ2duSnlBcklHVnVZMjlrYVc1bktTNTBiMHh2ZDJWeVEyRnpaU2dwWEc0Z0lDQWdJQ0FnSUd4dmQyVnlaV1JEWVhObElEMGdkSEoxWlZ4dUlDQWdJSDFjYmlBZ2ZWeHVmVnh1UW5WbVptVnlMbUo1ZEdWTVpXNW5kR2dnUFNCaWVYUmxUR1Z1WjNSb1hHNWNiaTh2SUhCeVpTMXpaWFFnWm05eUlIWmhiSFZsY3lCMGFHRjBJRzFoZVNCbGVHbHpkQ0JwYmlCMGFHVWdablYwZFhKbFhHNUNkV1ptWlhJdWNISnZkRzkwZVhCbExteGxibWQwYUNBOUlIVnVaR1ZtYVc1bFpGeHVRblZtWm1WeUxuQnliM1J2ZEhsd1pTNXdZWEpsYm5RZ1BTQjFibVJsWm1sdVpXUmNibHh1Wm5WdVkzUnBiMjRnYzJ4dmQxUnZVM1J5YVc1bklDaGxibU52WkdsdVp5d2djM1JoY25Rc0lHVnVaQ2tnZTF4dUlDQjJZWElnYkc5M1pYSmxaRU5oYzJVZ1BTQm1ZV3h6WlZ4dVhHNGdJSE4wWVhKMElEMGdjM1JoY25RZ2ZDQXdYRzRnSUdWdVpDQTlJR1Z1WkNBOVBUMGdkVzVrWldacGJtVmtJSHg4SUdWdVpDQTlQVDBnU1c1bWFXNXBkSGtnUHlCMGFHbHpMbXhsYm1kMGFDQTZJR1Z1WkNCOElEQmNibHh1SUNCcFppQW9JV1Z1WTI5a2FXNW5LU0JsYm1OdlpHbHVaeUE5SUNkMWRHWTRKMXh1SUNCcFppQW9jM1JoY25RZ1BDQXdLU0J6ZEdGeWRDQTlJREJjYmlBZ2FXWWdLR1Z1WkNBK0lIUm9hWE11YkdWdVozUm9LU0JsYm1RZ1BTQjBhR2x6TG14bGJtZDBhRnh1SUNCcFppQW9aVzVrSUR3OUlITjBZWEowS1NCeVpYUjFjbTRnSnlkY2JseHVJQ0IzYUdsc1pTQW9kSEoxWlNrZ2UxeHVJQ0FnSUhOM2FYUmphQ0FvWlc1amIyUnBibWNwSUh0Y2JpQWdJQ0FnSUdOaGMyVWdKMmhsZUNjNlhHNGdJQ0FnSUNBZ0lISmxkSFZ5YmlCb1pYaFRiR2xqWlNoMGFHbHpMQ0J6ZEdGeWRDd2daVzVrS1Z4dVhHNGdJQ0FnSUNCallYTmxJQ2QxZEdZNEp6cGNiaUFnSUNBZ0lHTmhjMlVnSjNWMFppMDRKenBjYmlBZ0lDQWdJQ0FnY21WMGRYSnVJSFYwWmpoVGJHbGpaU2gwYUdsekxDQnpkR0Z5ZEN3Z1pXNWtLVnh1WEc0Z0lDQWdJQ0JqWVhObElDZGhjMk5wYVNjNlhHNGdJQ0FnSUNBZ0lISmxkSFZ5YmlCaGMyTnBhVk5zYVdObEtIUm9hWE1zSUhOMFlYSjBMQ0JsYm1RcFhHNWNiaUFnSUNBZ0lHTmhjMlVnSjJKcGJtRnllU2M2WEc0Z0lDQWdJQ0FnSUhKbGRIVnliaUJpYVc1aGNubFRiR2xqWlNoMGFHbHpMQ0J6ZEdGeWRDd2daVzVrS1Z4dVhHNGdJQ0FnSUNCallYTmxJQ2RpWVhObE5qUW5PbHh1SUNBZ0lDQWdJQ0J5WlhSMWNtNGdZbUZ6WlRZMFUyeHBZMlVvZEdocGN5d2djM1JoY25Rc0lHVnVaQ2xjYmx4dUlDQWdJQ0FnWTJGelpTQW5kV056TWljNlhHNGdJQ0FnSUNCallYTmxJQ2QxWTNNdE1pYzZYRzRnSUNBZ0lDQmpZWE5sSUNkMWRHWXhObXhsSnpwY2JpQWdJQ0FnSUdOaGMyVWdKM1YwWmkweE5teGxKenBjYmlBZ0lDQWdJQ0FnY21WMGRYSnVJSFYwWmpFMmJHVlRiR2xqWlNoMGFHbHpMQ0J6ZEdGeWRDd2daVzVrS1Z4dVhHNGdJQ0FnSUNCa1pXWmhkV3gwT2x4dUlDQWdJQ0FnSUNCcFppQW9iRzkzWlhKbFpFTmhjMlVwSUhSb2NtOTNJRzVsZHlCVWVYQmxSWEp5YjNJb0oxVnVhMjV2ZDI0Z1pXNWpiMlJwYm1jNklDY2dLeUJsYm1OdlpHbHVaeWxjYmlBZ0lDQWdJQ0FnWlc1amIyUnBibWNnUFNBb1pXNWpiMlJwYm1jZ0t5QW5KeWt1ZEc5TWIzZGxja05oYzJVb0tWeHVJQ0FnSUNBZ0lDQnNiM2RsY21Wa1EyRnpaU0E5SUhSeWRXVmNiaUFnSUNCOVhHNGdJSDFjYm4xY2JseHVRblZtWm1WeUxuQnliM1J2ZEhsd1pTNTBiMU4wY21sdVp5QTlJR1oxYm1OMGFXOXVJSFJ2VTNSeWFXNW5JQ2dwSUh0Y2JpQWdkbUZ5SUd4bGJtZDBhQ0E5SUhSb2FYTXViR1Z1WjNSb0lId2dNRnh1SUNCcFppQW9iR1Z1WjNSb0lEMDlQU0F3S1NCeVpYUjFjbTRnSnlkY2JpQWdhV1lnS0dGeVozVnRaVzUwY3k1c1pXNW5kR2dnUFQwOUlEQXBJSEpsZEhWeWJpQjFkR1k0VTJ4cFkyVW9kR2hwY3l3Z01Dd2diR1Z1WjNSb0tWeHVJQ0J5WlhSMWNtNGdjMnh2ZDFSdlUzUnlhVzVuTG1Gd2NHeDVLSFJvYVhNc0lHRnlaM1Z0Wlc1MGN5bGNibjFjYmx4dVFuVm1abVZ5TG5CeWIzUnZkSGx3WlM1bGNYVmhiSE1nUFNCbWRXNWpkR2x2YmlCbGNYVmhiSE1nS0dJcElIdGNiaUFnYVdZZ0tDRkNkV1ptWlhJdWFYTkNkV1ptWlhJb1lpa3BJSFJvY205M0lHNWxkeUJVZVhCbFJYSnliM0lvSjBGeVozVnRaVzUwSUcxMWMzUWdZbVVnWVNCQ2RXWm1aWEluS1Z4dUlDQnBaaUFvZEdocGN5QTlQVDBnWWlrZ2NtVjBkWEp1SUhSeWRXVmNiaUFnY21WMGRYSnVJRUoxWm1abGNpNWpiMjF3WVhKbEtIUm9hWE1zSUdJcElEMDlQU0F3WEc1OVhHNWNia0oxWm1abGNpNXdjbTkwYjNSNWNHVXVhVzV6Y0dWamRDQTlJR1oxYm1OMGFXOXVJR2x1YzNCbFkzUWdLQ2tnZTF4dUlDQjJZWElnYzNSeUlEMGdKeWRjYmlBZ2RtRnlJRzFoZUNBOUlHVjRjRzl5ZEhNdVNVNVRVRVZEVkY5TlFWaGZRbGxVUlZOY2JpQWdhV1lnS0hSb2FYTXViR1Z1WjNSb0lENGdNQ2tnZTF4dUlDQWdJSE4wY2lBOUlIUm9hWE11ZEc5VGRISnBibWNvSjJobGVDY3NJREFzSUcxaGVDa3ViV0YwWTJnb0x5NTdNbjB2WnlrdWFtOXBiaWduSUNjcFhHNGdJQ0FnYVdZZ0tIUm9hWE11YkdWdVozUm9JRDRnYldGNEtTQnpkSElnS3owZ0p5QXVMaTRnSjF4dUlDQjlYRzRnSUhKbGRIVnliaUFuUEVKMVptWmxjaUFuSUNzZ2MzUnlJQ3NnSno0blhHNTlYRzVjYmtKMVptWmxjaTV3Y205MGIzUjVjR1V1WTI5dGNHRnlaU0E5SUdaMWJtTjBhVzl1SUdOdmJYQmhjbVVnS0dJcElIdGNiaUFnYVdZZ0tDRkNkV1ptWlhJdWFYTkNkV1ptWlhJb1lpa3BJSFJvY205M0lHNWxkeUJVZVhCbFJYSnliM0lvSjBGeVozVnRaVzUwSUcxMWMzUWdZbVVnWVNCQ2RXWm1aWEluS1Z4dUlDQnBaaUFvZEdocGN5QTlQVDBnWWlrZ2NtVjBkWEp1SURCY2JpQWdjbVYwZFhKdUlFSjFabVpsY2k1amIyMXdZWEpsS0hSb2FYTXNJR0lwWEc1OVhHNWNia0oxWm1abGNpNXdjbTkwYjNSNWNHVXVhVzVrWlhoUFppQTlJR1oxYm1OMGFXOXVJR2x1WkdWNFQyWWdLSFpoYkN3Z1lubDBaVTltWm5ObGRDa2dlMXh1SUNCcFppQW9ZbmwwWlU5bVpuTmxkQ0ErSURCNE4yWm1abVptWm1ZcElHSjVkR1ZQWm1aelpYUWdQU0F3ZURkbVptWm1abVptWEc0Z0lHVnNjMlVnYVdZZ0tHSjVkR1ZQWm1aelpYUWdQQ0F0TUhnNE1EQXdNREF3TUNrZ1lubDBaVTltWm5ObGRDQTlJQzB3ZURnd01EQXdNREF3WEc0Z0lHSjVkR1ZQWm1aelpYUWdQajQ5SURCY2JseHVJQ0JwWmlBb2RHaHBjeTVzWlc1bmRHZ2dQVDA5SURBcElISmxkSFZ5YmlBdE1WeHVJQ0JwWmlBb1lubDBaVTltWm5ObGRDQStQU0IwYUdsekxteGxibWQwYUNrZ2NtVjBkWEp1SUMweFhHNWNiaUFnTHk4Z1RtVm5ZWFJwZG1VZ2IyWm1jMlYwY3lCemRHRnlkQ0JtY205dElIUm9aU0JsYm1RZ2IyWWdkR2hsSUdKMVptWmxjbHh1SUNCcFppQW9ZbmwwWlU5bVpuTmxkQ0E4SURBcElHSjVkR1ZQWm1aelpYUWdQU0JOWVhSb0xtMWhlQ2gwYUdsekxteGxibWQwYUNBcklHSjVkR1ZQWm1aelpYUXNJREFwWEc1Y2JpQWdhV1lnS0hSNWNHVnZaaUIyWVd3Z1BUMDlJQ2R6ZEhKcGJtY25LU0I3WEc0Z0lDQWdhV1lnS0haaGJDNXNaVzVuZEdnZ1BUMDlJREFwSUhKbGRIVnliaUF0TVNBdkx5QnpjR1ZqYVdGc0lHTmhjMlU2SUd4dmIydHBibWNnWm05eUlHVnRjSFI1SUhOMGNtbHVaeUJoYkhkaGVYTWdabUZwYkhOY2JpQWdJQ0J5WlhSMWNtNGdVM1J5YVc1bkxuQnliM1J2ZEhsd1pTNXBibVJsZUU5bUxtTmhiR3dvZEdocGN5d2dkbUZzTENCaWVYUmxUMlptYzJWMEtWeHVJQ0I5WEc0Z0lHbG1JQ2hDZFdabVpYSXVhWE5DZFdabVpYSW9kbUZzS1NrZ2UxeHVJQ0FnSUhKbGRIVnliaUJoY25KaGVVbHVaR1Y0VDJZb2RHaHBjeXdnZG1Gc0xDQmllWFJsVDJabWMyVjBLVnh1SUNCOVhHNGdJR2xtSUNoMGVYQmxiMllnZG1Gc0lEMDlQU0FuYm5WdFltVnlKeWtnZTF4dUlDQWdJR2xtSUNoQ2RXWm1aWEl1VkZsUVJVUmZRVkpTUVZsZlUxVlFVRTlTVkNBbUppQlZhVzUwT0VGeWNtRjVMbkJ5YjNSdmRIbHdaUzVwYm1SbGVFOW1JRDA5UFNBblpuVnVZM1JwYjI0bktTQjdYRzRnSUNBZ0lDQnlaWFIxY200Z1ZXbHVkRGhCY25KaGVTNXdjbTkwYjNSNWNHVXVhVzVrWlhoUFppNWpZV3hzS0hSb2FYTXNJSFpoYkN3Z1lubDBaVTltWm5ObGRDbGNiaUFnSUNCOVhHNGdJQ0FnY21WMGRYSnVJR0Z5Y21GNVNXNWtaWGhQWmloMGFHbHpMQ0JiSUhaaGJDQmRMQ0JpZVhSbFQyWm1jMlYwS1Z4dUlDQjlYRzVjYmlBZ1puVnVZM1JwYjI0Z1lYSnlZWGxKYm1SbGVFOW1JQ2hoY25Jc0lIWmhiQ3dnWW5sMFpVOW1abk5sZENrZ2UxeHVJQ0FnSUhaaGNpQm1iM1Z1WkVsdVpHVjRJRDBnTFRGY2JpQWdJQ0JtYjNJZ0tIWmhjaUJwSUQwZ01Ec2dZbmwwWlU5bVpuTmxkQ0FySUdrZ1BDQmhjbkl1YkdWdVozUm9PeUJwS3lzcElIdGNiaUFnSUNBZ0lHbG1JQ2hoY25KYllubDBaVTltWm5ObGRDQXJJR2xkSUQwOVBTQjJZV3hiWm05MWJtUkpibVJsZUNBOVBUMGdMVEVnUHlBd0lEb2dhU0F0SUdadmRXNWtTVzVrWlhoZEtTQjdYRzRnSUNBZ0lDQWdJR2xtSUNobWIzVnVaRWx1WkdWNElEMDlQU0F0TVNrZ1ptOTFibVJKYm1SbGVDQTlJR2xjYmlBZ0lDQWdJQ0FnYVdZZ0tHa2dMU0JtYjNWdVpFbHVaR1Y0SUNzZ01TQTlQVDBnZG1Gc0xteGxibWQwYUNrZ2NtVjBkWEp1SUdKNWRHVlBabVp6WlhRZ0t5Qm1iM1Z1WkVsdVpHVjRYRzRnSUNBZ0lDQjlJR1ZzYzJVZ2UxeHVJQ0FnSUNBZ0lDQm1iM1Z1WkVsdVpHVjRJRDBnTFRGY2JpQWdJQ0FnSUgxY2JpQWdJQ0I5WEc0Z0lDQWdjbVYwZFhKdUlDMHhYRzRnSUgxY2JseHVJQ0IwYUhKdmR5QnVaWGNnVkhsd1pVVnljbTl5S0NkMllXd2diWFZ6ZENCaVpTQnpkSEpwYm1jc0lHNTFiV0psY2lCdmNpQkNkV1ptWlhJbktWeHVmVnh1WEc0dkx5QmdaMlYwWUNCcGN5QmtaWEJ5WldOaGRHVmtYRzVDZFdabVpYSXVjSEp2ZEc5MGVYQmxMbWRsZENBOUlHWjFibU4wYVc5dUlHZGxkQ0FvYjJabWMyVjBLU0I3WEc0Z0lHTnZibk52YkdVdWJHOW5LQ2N1WjJWMEtDa2dhWE1nWkdWd2NtVmpZWFJsWkM0Z1FXTmpaWE56SUhWemFXNW5JR0Z5Y21GNUlHbHVaR1Y0WlhNZ2FXNXpkR1ZoWkM0bktWeHVJQ0J5WlhSMWNtNGdkR2hwY3k1eVpXRmtWVWx1ZERnb2IyWm1jMlYwS1Z4dWZWeHVYRzR2THlCZ2MyVjBZQ0JwY3lCa1pYQnlaV05oZEdWa1hHNUNkV1ptWlhJdWNISnZkRzkwZVhCbExuTmxkQ0E5SUdaMWJtTjBhVzl1SUhObGRDQW9kaXdnYjJabWMyVjBLU0I3WEc0Z0lHTnZibk52YkdVdWJHOW5LQ2N1YzJWMEtDa2dhWE1nWkdWd2NtVmpZWFJsWkM0Z1FXTmpaWE56SUhWemFXNW5JR0Z5Y21GNUlHbHVaR1Y0WlhNZ2FXNXpkR1ZoWkM0bktWeHVJQ0J5WlhSMWNtNGdkR2hwY3k1M2NtbDBaVlZKYm5RNEtIWXNJRzltWm5ObGRDbGNibjFjYmx4dVpuVnVZM1JwYjI0Z2FHVjRWM0pwZEdVZ0tHSjFaaXdnYzNSeWFXNW5MQ0J2Wm1aelpYUXNJR3hsYm1kMGFDa2dlMXh1SUNCdlptWnpaWFFnUFNCT2RXMWlaWElvYjJabWMyVjBLU0I4ZkNBd1hHNGdJSFpoY2lCeVpXMWhhVzVwYm1jZ1BTQmlkV1l1YkdWdVozUm9JQzBnYjJabWMyVjBYRzRnSUdsbUlDZ2hiR1Z1WjNSb0tTQjdYRzRnSUNBZ2JHVnVaM1JvSUQwZ2NtVnRZV2x1YVc1blhHNGdJSDBnWld4elpTQjdYRzRnSUNBZ2JHVnVaM1JvSUQwZ1RuVnRZbVZ5S0d4bGJtZDBhQ2xjYmlBZ0lDQnBaaUFvYkdWdVozUm9JRDRnY21WdFlXbHVhVzVuS1NCN1hHNGdJQ0FnSUNCc1pXNW5kR2dnUFNCeVpXMWhhVzVwYm1kY2JpQWdJQ0I5WEc0Z0lIMWNibHh1SUNBdkx5QnRkWE4wSUdKbElHRnVJR1YyWlc0Z2JuVnRZbVZ5SUc5bUlHUnBaMmwwYzF4dUlDQjJZWElnYzNSeVRHVnVJRDBnYzNSeWFXNW5MbXhsYm1kMGFGeHVJQ0JwWmlBb2MzUnlUR1Z1SUNVZ01pQWhQVDBnTUNrZ2RHaHliM2NnYm1WM0lFVnljbTl5S0NkSmJuWmhiR2xrSUdobGVDQnpkSEpwYm1jbktWeHVYRzRnSUdsbUlDaHNaVzVuZEdnZ1BpQnpkSEpNWlc0Z0x5QXlLU0I3WEc0Z0lDQWdiR1Z1WjNSb0lEMGdjM1J5VEdWdUlDOGdNbHh1SUNCOVhHNGdJR1p2Y2lBb2RtRnlJR2tnUFNBd095QnBJRHdnYkdWdVozUm9PeUJwS3lzcElIdGNiaUFnSUNCMllYSWdjR0Z5YzJWa0lEMGdjR0Z5YzJWSmJuUW9jM1J5YVc1bkxuTjFZbk4wY2locElDb2dNaXdnTWlrc0lERTJLVnh1SUNBZ0lHbG1JQ2hwYzA1aFRpaHdZWEp6WldRcEtTQjBhSEp2ZHlCdVpYY2dSWEp5YjNJb0owbHVkbUZzYVdRZ2FHVjRJSE4wY21sdVp5Y3BYRzRnSUNBZ1luVm1XMjltWm5ObGRDQXJJR2xkSUQwZ2NHRnljMlZrWEc0Z0lIMWNiaUFnY21WMGRYSnVJR2xjYm4xY2JseHVablZ1WTNScGIyNGdkWFJtT0ZkeWFYUmxJQ2hpZFdZc0lITjBjbWx1Wnl3Z2IyWm1jMlYwTENCc1pXNW5kR2dwSUh0Y2JpQWdjbVYwZFhKdUlHSnNhWFJDZFdabVpYSW9kWFJtT0ZSdlFubDBaWE1vYzNSeWFXNW5MQ0JpZFdZdWJHVnVaM1JvSUMwZ2IyWm1jMlYwS1N3Z1luVm1MQ0J2Wm1aelpYUXNJR3hsYm1kMGFDbGNibjFjYmx4dVpuVnVZM1JwYjI0Z1lYTmphV2xYY21sMFpTQW9ZblZtTENCemRISnBibWNzSUc5bVpuTmxkQ3dnYkdWdVozUm9LU0I3WEc0Z0lISmxkSFZ5YmlCaWJHbDBRblZtWm1WeUtHRnpZMmxwVkc5Q2VYUmxjeWh6ZEhKcGJtY3BMQ0JpZFdZc0lHOW1abk5sZEN3Z2JHVnVaM1JvS1Z4dWZWeHVYRzVtZFc1amRHbHZiaUJpYVc1aGNubFhjbWwwWlNBb1luVm1MQ0J6ZEhKcGJtY3NJRzltWm5ObGRDd2diR1Z1WjNSb0tTQjdYRzRnSUhKbGRIVnliaUJoYzJOcGFWZHlhWFJsS0dKMVppd2djM1J5YVc1bkxDQnZabVp6WlhRc0lHeGxibWQwYUNsY2JuMWNibHh1Wm5WdVkzUnBiMjRnWW1GelpUWTBWM0pwZEdVZ0tHSjFaaXdnYzNSeWFXNW5MQ0J2Wm1aelpYUXNJR3hsYm1kMGFDa2dlMXh1SUNCeVpYUjFjbTRnWW14cGRFSjFabVpsY2loaVlYTmxOalJVYjBKNWRHVnpLSE4wY21sdVp5a3NJR0oxWml3Z2IyWm1jMlYwTENCc1pXNW5kR2dwWEc1OVhHNWNibVoxYm1OMGFXOXVJSFZqY3pKWGNtbDBaU0FvWW5WbUxDQnpkSEpwYm1jc0lHOW1abk5sZEN3Z2JHVnVaM1JvS1NCN1hHNGdJSEpsZEhWeWJpQmliR2wwUW5WbVptVnlLSFYwWmpFMmJHVlViMEo1ZEdWektITjBjbWx1Wnl3Z1luVm1MbXhsYm1kMGFDQXRJRzltWm5ObGRDa3NJR0oxWml3Z2IyWm1jMlYwTENCc1pXNW5kR2dwWEc1OVhHNWNia0oxWm1abGNpNXdjbTkwYjNSNWNHVXVkM0pwZEdVZ1BTQm1kVzVqZEdsdmJpQjNjbWwwWlNBb2MzUnlhVzVuTENCdlptWnpaWFFzSUd4bGJtZDBhQ3dnWlc1amIyUnBibWNwSUh0Y2JpQWdMeThnUW5WbVptVnlJM2R5YVhSbEtITjBjbWx1WnlsY2JpQWdhV1lnS0c5bVpuTmxkQ0E5UFQwZ2RXNWtaV1pwYm1Wa0tTQjdYRzRnSUNBZ1pXNWpiMlJwYm1jZ1BTQW5kWFJtT0NkY2JpQWdJQ0JzWlc1bmRHZ2dQU0IwYUdsekxteGxibWQwYUZ4dUlDQWdJRzltWm5ObGRDQTlJREJjYmlBZ0x5OGdRblZtWm1WeUkzZHlhWFJsS0hOMGNtbHVaeXdnWlc1amIyUnBibWNwWEc0Z0lIMGdaV3h6WlNCcFppQW9iR1Z1WjNSb0lEMDlQU0IxYm1SbFptbHVaV1FnSmlZZ2RIbHdaVzltSUc5bVpuTmxkQ0E5UFQwZ0ozTjBjbWx1WnljcElIdGNiaUFnSUNCbGJtTnZaR2x1WnlBOUlHOW1abk5sZEZ4dUlDQWdJR3hsYm1kMGFDQTlJSFJvYVhNdWJHVnVaM1JvWEc0Z0lDQWdiMlptYzJWMElEMGdNRnh1SUNBdkx5QkNkV1ptWlhJamQzSnBkR1VvYzNSeWFXNW5MQ0J2Wm1aelpYUmJMQ0JzWlc1bmRHaGRXeXdnWlc1amIyUnBibWRkS1Z4dUlDQjlJR1ZzYzJVZ2FXWWdLR2x6Um1sdWFYUmxLRzltWm5ObGRDa3BJSHRjYmlBZ0lDQnZabVp6WlhRZ1BTQnZabVp6WlhRZ2ZDQXdYRzRnSUNBZ2FXWWdLR2x6Um1sdWFYUmxLR3hsYm1kMGFDa3BJSHRjYmlBZ0lDQWdJR3hsYm1kMGFDQTlJR3hsYm1kMGFDQjhJREJjYmlBZ0lDQWdJR2xtSUNobGJtTnZaR2x1WnlBOVBUMGdkVzVrWldacGJtVmtLU0JsYm1OdlpHbHVaeUE5SUNkMWRHWTRKMXh1SUNBZ0lIMGdaV3h6WlNCN1hHNGdJQ0FnSUNCbGJtTnZaR2x1WnlBOUlHeGxibWQwYUZ4dUlDQWdJQ0FnYkdWdVozUm9JRDBnZFc1a1pXWnBibVZrWEc0Z0lDQWdmVnh1SUNBdkx5QnNaV2RoWTNrZ2QzSnBkR1VvYzNSeWFXNW5MQ0JsYm1OdlpHbHVaeXdnYjJabWMyVjBMQ0JzWlc1bmRHZ3BJQzBnY21WdGIzWmxJR2x1SUhZd0xqRXpYRzRnSUgwZ1pXeHpaU0I3WEc0Z0lDQWdkbUZ5SUhOM1lYQWdQU0JsYm1OdlpHbHVaMXh1SUNBZ0lHVnVZMjlrYVc1bklEMGdiMlptYzJWMFhHNGdJQ0FnYjJabWMyVjBJRDBnYkdWdVozUm9JSHdnTUZ4dUlDQWdJR3hsYm1kMGFDQTlJSE4zWVhCY2JpQWdmVnh1WEc0Z0lIWmhjaUJ5WlcxaGFXNXBibWNnUFNCMGFHbHpMbXhsYm1kMGFDQXRJRzltWm5ObGRGeHVJQ0JwWmlBb2JHVnVaM1JvSUQwOVBTQjFibVJsWm1sdVpXUWdmSHdnYkdWdVozUm9JRDRnY21WdFlXbHVhVzVuS1NCc1pXNW5kR2dnUFNCeVpXMWhhVzVwYm1kY2JseHVJQ0JwWmlBb0tITjBjbWx1Wnk1c1pXNW5kR2dnUGlBd0lDWW1JQ2hzWlc1bmRHZ2dQQ0F3SUh4OElHOW1abk5sZENBOElEQXBLU0I4ZkNCdlptWnpaWFFnUGlCMGFHbHpMbXhsYm1kMGFDa2dlMXh1SUNBZ0lIUm9jbTkzSUc1bGR5QlNZVzVuWlVWeWNtOXlLQ2RoZEhSbGJYQjBJSFJ2SUhkeWFYUmxJRzkxZEhOcFpHVWdZblZtWm1WeUlHSnZkVzVrY3ljcFhHNGdJSDFjYmx4dUlDQnBaaUFvSVdWdVkyOWthVzVuS1NCbGJtTnZaR2x1WnlBOUlDZDFkR1k0SjF4dVhHNGdJSFpoY2lCc2IzZGxjbVZrUTJGelpTQTlJR1poYkhObFhHNGdJR1p2Y2lBb096c3BJSHRjYmlBZ0lDQnpkMmwwWTJnZ0tHVnVZMjlrYVc1bktTQjdYRzRnSUNBZ0lDQmpZWE5sSUNkb1pYZ25PbHh1SUNBZ0lDQWdJQ0J5WlhSMWNtNGdhR1Y0VjNKcGRHVW9kR2hwY3l3Z2MzUnlhVzVuTENCdlptWnpaWFFzSUd4bGJtZDBhQ2xjYmx4dUlDQWdJQ0FnWTJGelpTQW5kWFJtT0NjNlhHNGdJQ0FnSUNCallYTmxJQ2QxZEdZdE9DYzZYRzRnSUNBZ0lDQWdJSEpsZEhWeWJpQjFkR1k0VjNKcGRHVW9kR2hwY3l3Z2MzUnlhVzVuTENCdlptWnpaWFFzSUd4bGJtZDBhQ2xjYmx4dUlDQWdJQ0FnWTJGelpTQW5ZWE5qYVdrbk9seHVJQ0FnSUNBZ0lDQnlaWFIxY200Z1lYTmphV2xYY21sMFpTaDBhR2x6TENCemRISnBibWNzSUc5bVpuTmxkQ3dnYkdWdVozUm9LVnh1WEc0Z0lDQWdJQ0JqWVhObElDZGlhVzVoY25rbk9seHVJQ0FnSUNBZ0lDQnlaWFIxY200Z1ltbHVZWEo1VjNKcGRHVW9kR2hwY3l3Z2MzUnlhVzVuTENCdlptWnpaWFFzSUd4bGJtZDBhQ2xjYmx4dUlDQWdJQ0FnWTJGelpTQW5ZbUZ6WlRZMEp6cGNiaUFnSUNBZ0lDQWdMeThnVjJGeWJtbHVaem9nYldGNFRHVnVaM1JvSUc1dmRDQjBZV3RsYmlCcGJuUnZJR0ZqWTI5MWJuUWdhVzRnWW1GelpUWTBWM0pwZEdWY2JpQWdJQ0FnSUNBZ2NtVjBkWEp1SUdKaGMyVTJORmR5YVhSbEtIUm9hWE1zSUhOMGNtbHVaeXdnYjJabWMyVjBMQ0JzWlc1bmRHZ3BYRzVjYmlBZ0lDQWdJR05oYzJVZ0ozVmpjekluT2x4dUlDQWdJQ0FnWTJGelpTQW5kV056TFRJbk9seHVJQ0FnSUNBZ1kyRnpaU0FuZFhSbU1UWnNaU2M2WEc0Z0lDQWdJQ0JqWVhObElDZDFkR1l0TVRac1pTYzZYRzRnSUNBZ0lDQWdJSEpsZEhWeWJpQjFZM015VjNKcGRHVW9kR2hwY3l3Z2MzUnlhVzVuTENCdlptWnpaWFFzSUd4bGJtZDBhQ2xjYmx4dUlDQWdJQ0FnWkdWbVlYVnNkRHBjYmlBZ0lDQWdJQ0FnYVdZZ0tHeHZkMlZ5WldSRFlYTmxLU0IwYUhKdmR5QnVaWGNnVkhsd1pVVnljbTl5S0NkVmJtdHViM2R1SUdWdVkyOWthVzVuT2lBbklDc2daVzVqYjJScGJtY3BYRzRnSUNBZ0lDQWdJR1Z1WTI5a2FXNW5JRDBnS0NjbklDc2daVzVqYjJScGJtY3BMblJ2VEc5M1pYSkRZWE5sS0NsY2JpQWdJQ0FnSUNBZ2JHOTNaWEpsWkVOaGMyVWdQU0IwY25WbFhHNGdJQ0FnZlZ4dUlDQjlYRzU5WEc1Y2JrSjFabVpsY2k1d2NtOTBiM1I1Y0dVdWRHOUtVMDlPSUQwZ1puVnVZM1JwYjI0Z2RHOUtVMDlPSUNncElIdGNiaUFnY21WMGRYSnVJSHRjYmlBZ0lDQjBlWEJsT2lBblFuVm1abVZ5Snl4Y2JpQWdJQ0JrWVhSaE9pQkJjbkpoZVM1d2NtOTBiM1I1Y0dVdWMyeHBZMlV1WTJGc2JDaDBhR2x6TGw5aGNuSWdmSHdnZEdocGN5d2dNQ2xjYmlBZ2ZWeHVmVnh1WEc1bWRXNWpkR2x2YmlCaVlYTmxOalJUYkdsalpTQW9ZblZtTENCemRHRnlkQ3dnWlc1a0tTQjdYRzRnSUdsbUlDaHpkR0Z5ZENBOVBUMGdNQ0FtSmlCbGJtUWdQVDA5SUdKMVppNXNaVzVuZEdncElIdGNiaUFnSUNCeVpYUjFjbTRnWW1GelpUWTBMbVp5YjIxQ2VYUmxRWEp5WVhrb1luVm1LVnh1SUNCOUlHVnNjMlVnZTF4dUlDQWdJSEpsZEhWeWJpQmlZWE5sTmpRdVpuSnZiVUo1ZEdWQmNuSmhlU2hpZFdZdWMyeHBZMlVvYzNSaGNuUXNJR1Z1WkNrcFhHNGdJSDFjYm4xY2JseHVablZ1WTNScGIyNGdkWFJtT0ZOc2FXTmxJQ2hpZFdZc0lITjBZWEowTENCbGJtUXBJSHRjYmlBZ2RtRnlJSEpsY3lBOUlDY25YRzRnSUhaaGNpQjBiWEFnUFNBbkoxeHVJQ0JsYm1RZ1BTQk5ZWFJvTG0xcGJpaGlkV1l1YkdWdVozUm9MQ0JsYm1RcFhHNWNiaUFnWm05eUlDaDJZWElnYVNBOUlITjBZWEowT3lCcElEd2daVzVrT3lCcEt5c3BJSHRjYmlBZ0lDQnBaaUFvWW5WbVcybGRJRHc5SURCNE4wWXBJSHRjYmlBZ0lDQWdJSEpsY3lBclBTQmtaV052WkdWVmRHWTRRMmhoY2loMGJYQXBJQ3NnVTNSeWFXNW5MbVp5YjIxRGFHRnlRMjlrWlNoaWRXWmJhVjBwWEc0Z0lDQWdJQ0IwYlhBZ1BTQW5KMXh1SUNBZ0lIMGdaV3h6WlNCN1hHNGdJQ0FnSUNCMGJYQWdLejBnSnlVbklDc2dZblZtVzJsZExuUnZVM1J5YVc1bktERTJLVnh1SUNBZ0lIMWNiaUFnZlZ4dVhHNGdJSEpsZEhWeWJpQnlaWE1nS3lCa1pXTnZaR1ZWZEdZNFEyaGhjaWgwYlhBcFhHNTlYRzVjYm1aMWJtTjBhVzl1SUdGelkybHBVMnhwWTJVZ0tHSjFaaXdnYzNSaGNuUXNJR1Z1WkNrZ2UxeHVJQ0IyWVhJZ2NtVjBJRDBnSnlkY2JpQWdaVzVrSUQwZ1RXRjBhQzV0YVc0b1luVm1MbXhsYm1kMGFDd2daVzVrS1Z4dVhHNGdJR1p2Y2lBb2RtRnlJR2tnUFNCemRHRnlkRHNnYVNBOElHVnVaRHNnYVNzcktTQjdYRzRnSUNBZ2NtVjBJQ3M5SUZOMGNtbHVaeTVtY205dFEyaGhja052WkdVb1luVm1XMmxkSUNZZ01IZzNSaWxjYmlBZ2ZWeHVJQ0J5WlhSMWNtNGdjbVYwWEc1OVhHNWNibVoxYm1OMGFXOXVJR0pwYm1GeWVWTnNhV05sSUNoaWRXWXNJSE4wWVhKMExDQmxibVFwSUh0Y2JpQWdkbUZ5SUhKbGRDQTlJQ2NuWEc0Z0lHVnVaQ0E5SUUxaGRHZ3ViV2x1S0dKMVppNXNaVzVuZEdnc0lHVnVaQ2xjYmx4dUlDQm1iM0lnS0haaGNpQnBJRDBnYzNSaGNuUTdJR2tnUENCbGJtUTdJR2tyS3lrZ2UxeHVJQ0FnSUhKbGRDQXJQU0JUZEhKcGJtY3Vabkp2YlVOb1lYSkRiMlJsS0dKMVpsdHBYU2xjYmlBZ2ZWeHVJQ0J5WlhSMWNtNGdjbVYwWEc1OVhHNWNibVoxYm1OMGFXOXVJR2hsZUZOc2FXTmxJQ2hpZFdZc0lITjBZWEowTENCbGJtUXBJSHRjYmlBZ2RtRnlJR3hsYmlBOUlHSjFaaTVzWlc1bmRHaGNibHh1SUNCcFppQW9JWE4wWVhKMElIeDhJSE4wWVhKMElEd2dNQ2tnYzNSaGNuUWdQU0F3WEc0Z0lHbG1JQ2doWlc1a0lIeDhJR1Z1WkNBOElEQWdmSHdnWlc1a0lENGdiR1Z1S1NCbGJtUWdQU0JzWlc1Y2JseHVJQ0IyWVhJZ2IzVjBJRDBnSnlkY2JpQWdabTl5SUNoMllYSWdhU0E5SUhOMFlYSjBPeUJwSUR3Z1pXNWtPeUJwS3lzcElIdGNiaUFnSUNCdmRYUWdLejBnZEc5SVpYZ29ZblZtVzJsZEtWeHVJQ0I5WEc0Z0lISmxkSFZ5YmlCdmRYUmNibjFjYmx4dVpuVnVZM1JwYjI0Z2RYUm1NVFpzWlZOc2FXTmxJQ2hpZFdZc0lITjBZWEowTENCbGJtUXBJSHRjYmlBZ2RtRnlJR0o1ZEdWeklEMGdZblZtTG5Oc2FXTmxLSE4wWVhKMExDQmxibVFwWEc0Z0lIWmhjaUJ5WlhNZ1BTQW5KMXh1SUNCbWIzSWdLSFpoY2lCcElEMGdNRHNnYVNBOElHSjVkR1Z6TG14bGJtZDBhRHNnYVNBclBTQXlLU0I3WEc0Z0lDQWdjbVZ6SUNzOUlGTjBjbWx1Wnk1bWNtOXRRMmhoY2tOdlpHVW9ZbmwwWlhOYmFWMGdLeUJpZVhSbGMxdHBJQ3NnTVYwZ0tpQXlOVFlwWEc0Z0lIMWNiaUFnY21WMGRYSnVJSEpsYzF4dWZWeHVYRzVDZFdabVpYSXVjSEp2ZEc5MGVYQmxMbk5zYVdObElEMGdablZ1WTNScGIyNGdjMnhwWTJVZ0tITjBZWEowTENCbGJtUXBJSHRjYmlBZ2RtRnlJR3hsYmlBOUlIUm9hWE11YkdWdVozUm9YRzRnSUhOMFlYSjBJRDBnZm41emRHRnlkRnh1SUNCbGJtUWdQU0JsYm1RZ1BUMDlJSFZ1WkdWbWFXNWxaQ0EvSUd4bGJpQTZJSDUrWlc1a1hHNWNiaUFnYVdZZ0tITjBZWEowSUR3Z01Da2dlMXh1SUNBZ0lITjBZWEowSUNzOUlHeGxibHh1SUNBZ0lHbG1JQ2h6ZEdGeWRDQThJREFwSUhOMFlYSjBJRDBnTUZ4dUlDQjlJR1ZzYzJVZ2FXWWdLSE4wWVhKMElENGdiR1Z1S1NCN1hHNGdJQ0FnYzNSaGNuUWdQU0JzWlc1Y2JpQWdmVnh1WEc0Z0lHbG1JQ2hsYm1RZ1BDQXdLU0I3WEc0Z0lDQWdaVzVrSUNzOUlHeGxibHh1SUNBZ0lHbG1JQ2hsYm1RZ1BDQXdLU0JsYm1RZ1BTQXdYRzRnSUgwZ1pXeHpaU0JwWmlBb1pXNWtJRDRnYkdWdUtTQjdYRzRnSUNBZ1pXNWtJRDBnYkdWdVhHNGdJSDFjYmx4dUlDQnBaaUFvWlc1a0lEd2djM1JoY25RcElHVnVaQ0E5SUhOMFlYSjBYRzVjYmlBZ2RtRnlJRzVsZDBKMVpseHVJQ0JwWmlBb1FuVm1abVZ5TGxSWlVFVkVYMEZTVWtGWlgxTlZVRkJQVWxRcElIdGNiaUFnSUNCdVpYZENkV1lnUFNCQ2RXWm1aWEl1WDJGMVoyMWxiblFvZEdocGN5NXpkV0poY25KaGVTaHpkR0Z5ZEN3Z1pXNWtLU2xjYmlBZ2ZTQmxiSE5sSUh0Y2JpQWdJQ0IyWVhJZ2MyeHBZMlZNWlc0Z1BTQmxibVFnTFNCemRHRnlkRnh1SUNBZ0lHNWxkMEoxWmlBOUlHNWxkeUJDZFdabVpYSW9jMnhwWTJWTVpXNHNJSFZ1WkdWbWFXNWxaQ2xjYmlBZ0lDQm1iM0lnS0haaGNpQnBJRDBnTURzZ2FTQThJSE5zYVdObFRHVnVPeUJwS3lzcElIdGNiaUFnSUNBZ0lHNWxkMEoxWmx0cFhTQTlJSFJvYVhOYmFTQXJJSE4wWVhKMFhWeHVJQ0FnSUgxY2JpQWdmVnh1WEc0Z0lHbG1JQ2h1WlhkQ2RXWXViR1Z1WjNSb0tTQnVaWGRDZFdZdWNHRnlaVzUwSUQwZ2RHaHBjeTV3WVhKbGJuUWdmSHdnZEdocGMxeHVYRzRnSUhKbGRIVnliaUJ1WlhkQ2RXWmNibjFjYmx4dUx5cGNiaUFxSUU1bFpXUWdkRzhnYldGclpTQnpkWEpsSUhSb1lYUWdZblZtWm1WeUlHbHpiaWQwSUhSeWVXbHVaeUIwYnlCM2NtbDBaU0J2ZFhRZ2IyWWdZbTkxYm1SekxseHVJQ292WEc1bWRXNWpkR2x2YmlCamFHVmphMDltWm5ObGRDQW9iMlptYzJWMExDQmxlSFFzSUd4bGJtZDBhQ2tnZTF4dUlDQnBaaUFvS0c5bVpuTmxkQ0FsSURFcElDRTlQU0F3SUh4OElHOW1abk5sZENBOElEQXBJSFJvY205M0lHNWxkeUJTWVc1blpVVnljbTl5S0NkdlptWnpaWFFnYVhNZ2JtOTBJSFZwYm5RbktWeHVJQ0JwWmlBb2IyWm1jMlYwSUNzZ1pYaDBJRDRnYkdWdVozUm9LU0IwYUhKdmR5QnVaWGNnVW1GdVoyVkZjbkp2Y2lnblZISjVhVzVuSUhSdklHRmpZMlZ6Y3lCaVpYbHZibVFnWW5WbVptVnlJR3hsYm1kMGFDY3BYRzU5WEc1Y2JrSjFabVpsY2k1d2NtOTBiM1I1Y0dVdWNtVmhaRlZKYm5STVJTQTlJR1oxYm1OMGFXOXVJSEpsWVdSVlNXNTBURVVnS0c5bVpuTmxkQ3dnWW5sMFpVeGxibWQwYUN3Z2JtOUJjM05sY25RcElIdGNiaUFnYjJabWMyVjBJRDBnYjJabWMyVjBJSHdnTUZ4dUlDQmllWFJsVEdWdVozUm9JRDBnWW5sMFpVeGxibWQwYUNCOElEQmNiaUFnYVdZZ0tDRnViMEZ6YzJWeWRDa2dZMmhsWTJ0UFptWnpaWFFvYjJabWMyVjBMQ0JpZVhSbFRHVnVaM1JvTENCMGFHbHpMbXhsYm1kMGFDbGNibHh1SUNCMllYSWdkbUZzSUQwZ2RHaHBjMXR2Wm1aelpYUmRYRzRnSUhaaGNpQnRkV3dnUFNBeFhHNGdJSFpoY2lCcElEMGdNRnh1SUNCM2FHbHNaU0FvS3l0cElEd2dZbmwwWlV4bGJtZDBhQ0FtSmlBb2JYVnNJQ285SURCNE1UQXdLU2tnZTF4dUlDQWdJSFpoYkNBclBTQjBhR2x6VzI5bVpuTmxkQ0FySUdsZElDb2diWFZzWEc0Z0lIMWNibHh1SUNCeVpYUjFjbTRnZG1Gc1hHNTlYRzVjYmtKMVptWmxjaTV3Y205MGIzUjVjR1V1Y21WaFpGVkpiblJDUlNBOUlHWjFibU4wYVc5dUlISmxZV1JWU1c1MFFrVWdLRzltWm5ObGRDd2dZbmwwWlV4bGJtZDBhQ3dnYm05QmMzTmxjblFwSUh0Y2JpQWdiMlptYzJWMElEMGdiMlptYzJWMElId2dNRnh1SUNCaWVYUmxUR1Z1WjNSb0lEMGdZbmwwWlV4bGJtZDBhQ0I4SURCY2JpQWdhV1lnS0NGdWIwRnpjMlZ5ZENrZ2UxeHVJQ0FnSUdOb1pXTnJUMlptYzJWMEtHOW1abk5sZEN3Z1lubDBaVXhsYm1kMGFDd2dkR2hwY3k1c1pXNW5kR2dwWEc0Z0lIMWNibHh1SUNCMllYSWdkbUZzSUQwZ2RHaHBjMXR2Wm1aelpYUWdLeUF0TFdKNWRHVk1aVzVuZEdoZFhHNGdJSFpoY2lCdGRXd2dQU0F4WEc0Z0lIZG9hV3hsSUNoaWVYUmxUR1Z1WjNSb0lENGdNQ0FtSmlBb2JYVnNJQ285SURCNE1UQXdLU2tnZTF4dUlDQWdJSFpoYkNBclBTQjBhR2x6VzI5bVpuTmxkQ0FySUMwdFlubDBaVXhsYm1kMGFGMGdLaUJ0ZFd4Y2JpQWdmVnh1WEc0Z0lISmxkSFZ5YmlCMllXeGNibjFjYmx4dVFuVm1abVZ5TG5CeWIzUnZkSGx3WlM1eVpXRmtWVWx1ZERnZ1BTQm1kVzVqZEdsdmJpQnlaV0ZrVlVsdWREZ2dLRzltWm5ObGRDd2dibTlCYzNObGNuUXBJSHRjYmlBZ2FXWWdLQ0Z1YjBGemMyVnlkQ2tnWTJobFkydFBabVp6WlhRb2IyWm1jMlYwTENBeExDQjBhR2x6TG14bGJtZDBhQ2xjYmlBZ2NtVjBkWEp1SUhSb2FYTmJiMlptYzJWMFhWeHVmVnh1WEc1Q2RXWm1aWEl1Y0hKdmRHOTBlWEJsTG5KbFlXUlZTVzUwTVRaTVJTQTlJR1oxYm1OMGFXOXVJSEpsWVdSVlNXNTBNVFpNUlNBb2IyWm1jMlYwTENCdWIwRnpjMlZ5ZENrZ2UxeHVJQ0JwWmlBb0lXNXZRWE56WlhKMEtTQmphR1ZqYTA5bVpuTmxkQ2h2Wm1aelpYUXNJRElzSUhSb2FYTXViR1Z1WjNSb0tWeHVJQ0J5WlhSMWNtNGdkR2hwYzF0dlptWnpaWFJkSUh3Z0tIUm9hWE5iYjJabWMyVjBJQ3NnTVYwZ1BEd2dPQ2xjYm4xY2JseHVRblZtWm1WeUxuQnliM1J2ZEhsd1pTNXlaV0ZrVlVsdWRERTJRa1VnUFNCbWRXNWpkR2x2YmlCeVpXRmtWVWx1ZERFMlFrVWdLRzltWm5ObGRDd2dibTlCYzNObGNuUXBJSHRjYmlBZ2FXWWdLQ0Z1YjBGemMyVnlkQ2tnWTJobFkydFBabVp6WlhRb2IyWm1jMlYwTENBeUxDQjBhR2x6TG14bGJtZDBhQ2xjYmlBZ2NtVjBkWEp1SUNoMGFHbHpXMjltWm5ObGRGMGdQRHdnT0NrZ2ZDQjBhR2x6VzI5bVpuTmxkQ0FySURGZFhHNTlYRzVjYmtKMVptWmxjaTV3Y205MGIzUjVjR1V1Y21WaFpGVkpiblF6TWt4RklEMGdablZ1WTNScGIyNGdjbVZoWkZWSmJuUXpNa3hGSUNodlptWnpaWFFzSUc1dlFYTnpaWEowS1NCN1hHNGdJR2xtSUNnaGJtOUJjM05sY25RcElHTm9aV05yVDJabWMyVjBLRzltWm5ObGRDd2dOQ3dnZEdocGN5NXNaVzVuZEdncFhHNWNiaUFnY21WMGRYSnVJQ2dvZEdocGMxdHZabVp6WlhSZEtTQjhYRzRnSUNBZ0lDQW9kR2hwYzF0dlptWnpaWFFnS3lBeFhTQThQQ0E0S1NCOFhHNGdJQ0FnSUNBb2RHaHBjMXR2Wm1aelpYUWdLeUF5WFNBOFBDQXhOaWtwSUN0Y2JpQWdJQ0FnSUNoMGFHbHpXMjltWm5ObGRDQXJJRE5kSUNvZ01IZ3hNREF3TURBd0tWeHVmVnh1WEc1Q2RXWm1aWEl1Y0hKdmRHOTBlWEJsTG5KbFlXUlZTVzUwTXpKQ1JTQTlJR1oxYm1OMGFXOXVJSEpsWVdSVlNXNTBNekpDUlNBb2IyWm1jMlYwTENCdWIwRnpjMlZ5ZENrZ2UxeHVJQ0JwWmlBb0lXNXZRWE56WlhKMEtTQmphR1ZqYTA5bVpuTmxkQ2h2Wm1aelpYUXNJRFFzSUhSb2FYTXViR1Z1WjNSb0tWeHVYRzRnSUhKbGRIVnliaUFvZEdocGMxdHZabVp6WlhSZElDb2dNSGd4TURBd01EQXdLU0FyWEc0Z0lDQWdLQ2gwYUdselcyOW1abk5sZENBcklERmRJRHc4SURFMktTQjhYRzRnSUNBZ0tIUm9hWE5iYjJabWMyVjBJQ3NnTWwwZ1BEd2dPQ2tnZkZ4dUlDQWdJSFJvYVhOYmIyWm1jMlYwSUNzZ00xMHBYRzU5WEc1Y2JrSjFabVpsY2k1d2NtOTBiM1I1Y0dVdWNtVmhaRWx1ZEV4RklEMGdablZ1WTNScGIyNGdjbVZoWkVsdWRFeEZJQ2h2Wm1aelpYUXNJR0o1ZEdWTVpXNW5kR2dzSUc1dlFYTnpaWEowS1NCN1hHNGdJRzltWm5ObGRDQTlJRzltWm5ObGRDQjhJREJjYmlBZ1lubDBaVXhsYm1kMGFDQTlJR0o1ZEdWTVpXNW5kR2dnZkNBd1hHNGdJR2xtSUNnaGJtOUJjM05sY25RcElHTm9aV05yVDJabWMyVjBLRzltWm5ObGRDd2dZbmwwWlV4bGJtZDBhQ3dnZEdocGN5NXNaVzVuZEdncFhHNWNiaUFnZG1GeUlIWmhiQ0E5SUhSb2FYTmJiMlptYzJWMFhWeHVJQ0IyWVhJZ2JYVnNJRDBnTVZ4dUlDQjJZWElnYVNBOUlEQmNiaUFnZDJocGJHVWdLQ3NyYVNBOElHSjVkR1ZNWlc1bmRHZ2dKaVlnS0cxMWJDQXFQU0F3ZURFd01Da3BJSHRjYmlBZ0lDQjJZV3dnS3owZ2RHaHBjMXR2Wm1aelpYUWdLeUJwWFNBcUlHMTFiRnh1SUNCOVhHNGdJRzExYkNBcVBTQXdlRGd3WEc1Y2JpQWdhV1lnS0haaGJDQStQU0J0ZFd3cElIWmhiQ0F0UFNCTllYUm9MbkJ2ZHlneUxDQTRJQ29nWW5sMFpVeGxibWQwYUNsY2JseHVJQ0J5WlhSMWNtNGdkbUZzWEc1OVhHNWNia0oxWm1abGNpNXdjbTkwYjNSNWNHVXVjbVZoWkVsdWRFSkZJRDBnWm5WdVkzUnBiMjRnY21WaFpFbHVkRUpGSUNodlptWnpaWFFzSUdKNWRHVk1aVzVuZEdnc0lHNXZRWE56WlhKMEtTQjdYRzRnSUc5bVpuTmxkQ0E5SUc5bVpuTmxkQ0I4SURCY2JpQWdZbmwwWlV4bGJtZDBhQ0E5SUdKNWRHVk1aVzVuZEdnZ2ZDQXdYRzRnSUdsbUlDZ2hibTlCYzNObGNuUXBJR05vWldOclQyWm1jMlYwS0c5bVpuTmxkQ3dnWW5sMFpVeGxibWQwYUN3Z2RHaHBjeTVzWlc1bmRHZ3BYRzVjYmlBZ2RtRnlJR2tnUFNCaWVYUmxUR1Z1WjNSb1hHNGdJSFpoY2lCdGRXd2dQU0F4WEc0Z0lIWmhjaUIyWVd3Z1BTQjBhR2x6VzI5bVpuTmxkQ0FySUMwdGFWMWNiaUFnZDJocGJHVWdLR2tnUGlBd0lDWW1JQ2h0ZFd3Z0tqMGdNSGd4TURBcEtTQjdYRzRnSUNBZ2RtRnNJQ3M5SUhSb2FYTmJiMlptYzJWMElDc2dMUzFwWFNBcUlHMTFiRnh1SUNCOVhHNGdJRzExYkNBcVBTQXdlRGd3WEc1Y2JpQWdhV1lnS0haaGJDQStQU0J0ZFd3cElIWmhiQ0F0UFNCTllYUm9MbkJ2ZHlneUxDQTRJQ29nWW5sMFpVeGxibWQwYUNsY2JseHVJQ0J5WlhSMWNtNGdkbUZzWEc1OVhHNWNia0oxWm1abGNpNXdjbTkwYjNSNWNHVXVjbVZoWkVsdWREZ2dQU0JtZFc1amRHbHZiaUJ5WldGa1NXNTBPQ0FvYjJabWMyVjBMQ0J1YjBGemMyVnlkQ2tnZTF4dUlDQnBaaUFvSVc1dlFYTnpaWEowS1NCamFHVmphMDltWm5ObGRDaHZabVp6WlhRc0lERXNJSFJvYVhNdWJHVnVaM1JvS1Z4dUlDQnBaaUFvSVNoMGFHbHpXMjltWm5ObGRGMGdKaUF3ZURnd0tTa2djbVYwZFhKdUlDaDBhR2x6VzI5bVpuTmxkRjBwWEc0Z0lISmxkSFZ5YmlBb0tEQjRabVlnTFNCMGFHbHpXMjltWm5ObGRGMGdLeUF4S1NBcUlDMHhLVnh1ZlZ4dVhHNUNkV1ptWlhJdWNISnZkRzkwZVhCbExuSmxZV1JKYm5ReE5reEZJRDBnWm5WdVkzUnBiMjRnY21WaFpFbHVkREUyVEVVZ0tHOW1abk5sZEN3Z2JtOUJjM05sY25RcElIdGNiaUFnYVdZZ0tDRnViMEZ6YzJWeWRDa2dZMmhsWTJ0UFptWnpaWFFvYjJabWMyVjBMQ0F5TENCMGFHbHpMbXhsYm1kMGFDbGNiaUFnZG1GeUlIWmhiQ0E5SUhSb2FYTmJiMlptYzJWMFhTQjhJQ2gwYUdselcyOW1abk5sZENBcklERmRJRHc4SURncFhHNGdJSEpsZEhWeWJpQW9kbUZzSUNZZ01IZzRNREF3S1NBL0lIWmhiQ0I4SURCNFJrWkdSakF3TURBZ09pQjJZV3hjYm4xY2JseHVRblZtWm1WeUxuQnliM1J2ZEhsd1pTNXlaV0ZrU1c1ME1UWkNSU0E5SUdaMWJtTjBhVzl1SUhKbFlXUkpiblF4TmtKRklDaHZabVp6WlhRc0lHNXZRWE56WlhKMEtTQjdYRzRnSUdsbUlDZ2hibTlCYzNObGNuUXBJR05vWldOclQyWm1jMlYwS0c5bVpuTmxkQ3dnTWl3Z2RHaHBjeTVzWlc1bmRHZ3BYRzRnSUhaaGNpQjJZV3dnUFNCMGFHbHpXMjltWm5ObGRDQXJJREZkSUh3Z0tIUm9hWE5iYjJabWMyVjBYU0E4UENBNEtWeHVJQ0J5WlhSMWNtNGdLSFpoYkNBbUlEQjRPREF3TUNrZ1B5QjJZV3dnZkNBd2VFWkdSa1l3TURBd0lEb2dkbUZzWEc1OVhHNWNia0oxWm1abGNpNXdjbTkwYjNSNWNHVXVjbVZoWkVsdWRETXlURVVnUFNCbWRXNWpkR2x2YmlCeVpXRmtTVzUwTXpKTVJTQW9iMlptYzJWMExDQnViMEZ6YzJWeWRDa2dlMXh1SUNCcFppQW9JVzV2UVhOelpYSjBLU0JqYUdWamEwOW1abk5sZENodlptWnpaWFFzSURRc0lIUm9hWE11YkdWdVozUm9LVnh1WEc0Z0lISmxkSFZ5YmlBb2RHaHBjMXR2Wm1aelpYUmRLU0I4WEc0Z0lDQWdLSFJvYVhOYmIyWm1jMlYwSUNzZ01WMGdQRHdnT0NrZ2ZGeHVJQ0FnSUNoMGFHbHpXMjltWm5ObGRDQXJJREpkSUR3OElERTJLU0I4WEc0Z0lDQWdLSFJvYVhOYmIyWm1jMlYwSUNzZ00xMGdQRHdnTWpRcFhHNTlYRzVjYmtKMVptWmxjaTV3Y205MGIzUjVjR1V1Y21WaFpFbHVkRE15UWtVZ1BTQm1kVzVqZEdsdmJpQnlaV0ZrU1c1ME16SkNSU0FvYjJabWMyVjBMQ0J1YjBGemMyVnlkQ2tnZTF4dUlDQnBaaUFvSVc1dlFYTnpaWEowS1NCamFHVmphMDltWm5ObGRDaHZabVp6WlhRc0lEUXNJSFJvYVhNdWJHVnVaM1JvS1Z4dVhHNGdJSEpsZEhWeWJpQW9kR2hwYzF0dlptWnpaWFJkSUR3OElESTBLU0I4WEc0Z0lDQWdLSFJvYVhOYmIyWm1jMlYwSUNzZ01WMGdQRHdnTVRZcElIeGNiaUFnSUNBb2RHaHBjMXR2Wm1aelpYUWdLeUF5WFNBOFBDQTRLU0I4WEc0Z0lDQWdLSFJvYVhOYmIyWm1jMlYwSUNzZ00xMHBYRzU5WEc1Y2JrSjFabVpsY2k1d2NtOTBiM1I1Y0dVdWNtVmhaRVpzYjJGMFRFVWdQU0JtZFc1amRHbHZiaUJ5WldGa1JteHZZWFJNUlNBb2IyWm1jMlYwTENCdWIwRnpjMlZ5ZENrZ2UxeHVJQ0JwWmlBb0lXNXZRWE56WlhKMEtTQmphR1ZqYTA5bVpuTmxkQ2h2Wm1aelpYUXNJRFFzSUhSb2FYTXViR1Z1WjNSb0tWeHVJQ0J5WlhSMWNtNGdhV1ZsWlRjMU5DNXlaV0ZrS0hSb2FYTXNJRzltWm5ObGRDd2dkSEoxWlN3Z01qTXNJRFFwWEc1OVhHNWNia0oxWm1abGNpNXdjbTkwYjNSNWNHVXVjbVZoWkVac2IyRjBRa1VnUFNCbWRXNWpkR2x2YmlCeVpXRmtSbXh2WVhSQ1JTQW9iMlptYzJWMExDQnViMEZ6YzJWeWRDa2dlMXh1SUNCcFppQW9JVzV2UVhOelpYSjBLU0JqYUdWamEwOW1abk5sZENodlptWnpaWFFzSURRc0lIUm9hWE11YkdWdVozUm9LVnh1SUNCeVpYUjFjbTRnYVdWbFpUYzFOQzV5WldGa0tIUm9hWE1zSUc5bVpuTmxkQ3dnWm1Gc2MyVXNJREl6TENBMEtWeHVmVnh1WEc1Q2RXWm1aWEl1Y0hKdmRHOTBlWEJsTG5KbFlXUkViM1ZpYkdWTVJTQTlJR1oxYm1OMGFXOXVJSEpsWVdSRWIzVmliR1ZNUlNBb2IyWm1jMlYwTENCdWIwRnpjMlZ5ZENrZ2UxeHVJQ0JwWmlBb0lXNXZRWE56WlhKMEtTQmphR1ZqYTA5bVpuTmxkQ2h2Wm1aelpYUXNJRGdzSUhSb2FYTXViR1Z1WjNSb0tWeHVJQ0J5WlhSMWNtNGdhV1ZsWlRjMU5DNXlaV0ZrS0hSb2FYTXNJRzltWm5ObGRDd2dkSEoxWlN3Z05USXNJRGdwWEc1OVhHNWNia0oxWm1abGNpNXdjbTkwYjNSNWNHVXVjbVZoWkVSdmRXSnNaVUpGSUQwZ1puVnVZM1JwYjI0Z2NtVmhaRVJ2ZFdKc1pVSkZJQ2h2Wm1aelpYUXNJRzV2UVhOelpYSjBLU0I3WEc0Z0lHbG1JQ2doYm05QmMzTmxjblFwSUdOb1pXTnJUMlptYzJWMEtHOW1abk5sZEN3Z09Dd2dkR2hwY3k1c1pXNW5kR2dwWEc0Z0lISmxkSFZ5YmlCcFpXVmxOelUwTG5KbFlXUW9kR2hwY3l3Z2IyWm1jMlYwTENCbVlXeHpaU3dnTlRJc0lEZ3BYRzU5WEc1Y2JtWjFibU4wYVc5dUlHTm9aV05yU1c1MElDaGlkV1lzSUhaaGJIVmxMQ0J2Wm1aelpYUXNJR1Y0ZEN3Z2JXRjRMQ0J0YVc0cElIdGNiaUFnYVdZZ0tDRkNkV1ptWlhJdWFYTkNkV1ptWlhJb1luVm1LU2tnZEdoeWIzY2dibVYzSUZSNWNHVkZjbkp2Y2lnblluVm1abVZ5SUcxMWMzUWdZbVVnWVNCQ2RXWm1aWElnYVc1emRHRnVZMlVuS1Z4dUlDQnBaaUFvZG1Gc2RXVWdQaUJ0WVhnZ2ZId2dkbUZzZFdVZ1BDQnRhVzRwSUhSb2NtOTNJRzVsZHlCU1lXNW5aVVZ5Y205eUtDZDJZV3gxWlNCcGN5QnZkWFFnYjJZZ1ltOTFibVJ6SnlsY2JpQWdhV1lnS0c5bVpuTmxkQ0FySUdWNGRDQStJR0oxWmk1c1pXNW5kR2dwSUhSb2NtOTNJRzVsZHlCU1lXNW5aVVZ5Y205eUtDZHBibVJsZUNCdmRYUWdiMllnY21GdVoyVW5LVnh1ZlZ4dVhHNUNkV1ptWlhJdWNISnZkRzkwZVhCbExuZHlhWFJsVlVsdWRFeEZJRDBnWm5WdVkzUnBiMjRnZDNKcGRHVlZTVzUwVEVVZ0tIWmhiSFZsTENCdlptWnpaWFFzSUdKNWRHVk1aVzVuZEdnc0lHNXZRWE56WlhKMEtTQjdYRzRnSUhaaGJIVmxJRDBnSzNaaGJIVmxYRzRnSUc5bVpuTmxkQ0E5SUc5bVpuTmxkQ0I4SURCY2JpQWdZbmwwWlV4bGJtZDBhQ0E5SUdKNWRHVk1aVzVuZEdnZ2ZDQXdYRzRnSUdsbUlDZ2hibTlCYzNObGNuUXBJR05vWldOclNXNTBLSFJvYVhNc0lIWmhiSFZsTENCdlptWnpaWFFzSUdKNWRHVk1aVzVuZEdnc0lFMWhkR2d1Y0c5M0tESXNJRGdnS2lCaWVYUmxUR1Z1WjNSb0tTd2dNQ2xjYmx4dUlDQjJZWElnYlhWc0lEMGdNVnh1SUNCMllYSWdhU0E5SURCY2JpQWdkR2hwYzF0dlptWnpaWFJkSUQwZ2RtRnNkV1VnSmlBd2VFWkdYRzRnSUhkb2FXeGxJQ2dySzJrZ1BDQmllWFJsVEdWdVozUm9JQ1ltSUNodGRXd2dLajBnTUhneE1EQXBLU0I3WEc0Z0lDQWdkR2hwYzF0dlptWnpaWFFnS3lCcFhTQTlJQ2gyWVd4MVpTQXZJRzExYkNrZ0ppQXdlRVpHWEc0Z0lIMWNibHh1SUNCeVpYUjFjbTRnYjJabWMyVjBJQ3NnWW5sMFpVeGxibWQwYUZ4dWZWeHVYRzVDZFdabVpYSXVjSEp2ZEc5MGVYQmxMbmR5YVhSbFZVbHVkRUpGSUQwZ1puVnVZM1JwYjI0Z2QzSnBkR1ZWU1c1MFFrVWdLSFpoYkhWbExDQnZabVp6WlhRc0lHSjVkR1ZNWlc1bmRHZ3NJRzV2UVhOelpYSjBLU0I3WEc0Z0lIWmhiSFZsSUQwZ0szWmhiSFZsWEc0Z0lHOW1abk5sZENBOUlHOW1abk5sZENCOElEQmNiaUFnWW5sMFpVeGxibWQwYUNBOUlHSjVkR1ZNWlc1bmRHZ2dmQ0F3WEc0Z0lHbG1JQ2doYm05QmMzTmxjblFwSUdOb1pXTnJTVzUwS0hSb2FYTXNJSFpoYkhWbExDQnZabVp6WlhRc0lHSjVkR1ZNWlc1bmRHZ3NJRTFoZEdndWNHOTNLRElzSURnZ0tpQmllWFJsVEdWdVozUm9LU3dnTUNsY2JseHVJQ0IyWVhJZ2FTQTlJR0o1ZEdWTVpXNW5kR2dnTFNBeFhHNGdJSFpoY2lCdGRXd2dQU0F4WEc0Z0lIUm9hWE5iYjJabWMyVjBJQ3NnYVYwZ1BTQjJZV3gxWlNBbUlEQjRSa1pjYmlBZ2QyaHBiR1VnS0MwdGFTQStQU0F3SUNZbUlDaHRkV3dnS2owZ01IZ3hNREFwS1NCN1hHNGdJQ0FnZEdocGMxdHZabVp6WlhRZ0t5QnBYU0E5SUNoMllXeDFaU0F2SUcxMWJDa2dKaUF3ZUVaR1hHNGdJSDFjYmx4dUlDQnlaWFIxY200Z2IyWm1jMlYwSUNzZ1lubDBaVXhsYm1kMGFGeHVmVnh1WEc1Q2RXWm1aWEl1Y0hKdmRHOTBlWEJsTG5keWFYUmxWVWx1ZERnZ1BTQm1kVzVqZEdsdmJpQjNjbWwwWlZWSmJuUTRJQ2gyWVd4MVpTd2diMlptYzJWMExDQnViMEZ6YzJWeWRDa2dlMXh1SUNCMllXeDFaU0E5SUN0MllXeDFaVnh1SUNCdlptWnpaWFFnUFNCdlptWnpaWFFnZkNBd1hHNGdJR2xtSUNnaGJtOUJjM05sY25RcElHTm9aV05yU1c1MEtIUm9hWE1zSUhaaGJIVmxMQ0J2Wm1aelpYUXNJREVzSURCNFptWXNJREFwWEc0Z0lHbG1JQ2doUW5WbVptVnlMbFJaVUVWRVgwRlNVa0ZaWDFOVlVGQlBVbFFwSUhaaGJIVmxJRDBnVFdGMGFDNW1iRzl2Y2loMllXeDFaU2xjYmlBZ2RHaHBjMXR2Wm1aelpYUmRJRDBnZG1Gc2RXVmNiaUFnY21WMGRYSnVJRzltWm5ObGRDQXJJREZjYm4xY2JseHVablZ1WTNScGIyNGdiMkpxWldOMFYzSnBkR1ZWU1c1ME1UWWdLR0oxWml3Z2RtRnNkV1VzSUc5bVpuTmxkQ3dnYkdsMGRHeGxSVzVrYVdGdUtTQjdYRzRnSUdsbUlDaDJZV3gxWlNBOElEQXBJSFpoYkhWbElEMGdNSGhtWm1abUlDc2dkbUZzZFdVZ0t5QXhYRzRnSUdadmNpQW9kbUZ5SUdrZ1BTQXdMQ0JxSUQwZ1RXRjBhQzV0YVc0b1luVm1MbXhsYm1kMGFDQXRJRzltWm5ObGRDd2dNaWs3SUdrZ1BDQnFPeUJwS3lzcElIdGNiaUFnSUNCaWRXWmJiMlptYzJWMElDc2dhVjBnUFNBb2RtRnNkV1VnSmlBb01IaG1aaUE4UENBb09DQXFJQ2hzYVhSMGJHVkZibVJwWVc0Z1B5QnBJRG9nTVNBdElHa3BLU2twSUQ0K1BseHVJQ0FnSUNBZ0tHeHBkSFJzWlVWdVpHbGhiaUEvSUdrZ09pQXhJQzBnYVNrZ0tpQTRYRzRnSUgxY2JuMWNibHh1UW5WbVptVnlMbkJ5YjNSdmRIbHdaUzUzY21sMFpWVkpiblF4Tmt4RklEMGdablZ1WTNScGIyNGdkM0pwZEdWVlNXNTBNVFpNUlNBb2RtRnNkV1VzSUc5bVpuTmxkQ3dnYm05QmMzTmxjblFwSUh0Y2JpQWdkbUZzZFdVZ1BTQXJkbUZzZFdWY2JpQWdiMlptYzJWMElEMGdiMlptYzJWMElId2dNRnh1SUNCcFppQW9JVzV2UVhOelpYSjBLU0JqYUdWamEwbHVkQ2gwYUdsekxDQjJZV3gxWlN3Z2IyWm1jMlYwTENBeUxDQXdlR1ptWm1Zc0lEQXBYRzRnSUdsbUlDaENkV1ptWlhJdVZGbFFSVVJmUVZKU1FWbGZVMVZRVUU5U1ZDa2dlMXh1SUNBZ0lIUm9hWE5iYjJabWMyVjBYU0E5SUhaaGJIVmxYRzRnSUNBZ2RHaHBjMXR2Wm1aelpYUWdLeUF4WFNBOUlDaDJZV3gxWlNBK1BqNGdPQ2xjYmlBZ2ZTQmxiSE5sSUh0Y2JpQWdJQ0J2WW1wbFkzUlhjbWwwWlZWSmJuUXhOaWgwYUdsekxDQjJZV3gxWlN3Z2IyWm1jMlYwTENCMGNuVmxLVnh1SUNCOVhHNGdJSEpsZEhWeWJpQnZabVp6WlhRZ0t5QXlYRzU5WEc1Y2JrSjFabVpsY2k1d2NtOTBiM1I1Y0dVdWQzSnBkR1ZWU1c1ME1UWkNSU0E5SUdaMWJtTjBhVzl1SUhkeWFYUmxWVWx1ZERFMlFrVWdLSFpoYkhWbExDQnZabVp6WlhRc0lHNXZRWE56WlhKMEtTQjdYRzRnSUhaaGJIVmxJRDBnSzNaaGJIVmxYRzRnSUc5bVpuTmxkQ0E5SUc5bVpuTmxkQ0I4SURCY2JpQWdhV1lnS0NGdWIwRnpjMlZ5ZENrZ1kyaGxZMnRKYm5Rb2RHaHBjeXdnZG1Gc2RXVXNJRzltWm5ObGRDd2dNaXdnTUhobVptWm1MQ0F3S1Z4dUlDQnBaaUFvUW5WbVptVnlMbFJaVUVWRVgwRlNVa0ZaWDFOVlVGQlBVbFFwSUh0Y2JpQWdJQ0IwYUdselcyOW1abk5sZEYwZ1BTQW9kbUZzZFdVZ1BqNCtJRGdwWEc0Z0lDQWdkR2hwYzF0dlptWnpaWFFnS3lBeFhTQTlJSFpoYkhWbFhHNGdJSDBnWld4elpTQjdYRzRnSUNBZ2IySnFaV04wVjNKcGRHVlZTVzUwTVRZb2RHaHBjeXdnZG1Gc2RXVXNJRzltWm5ObGRDd2dabUZzYzJVcFhHNGdJSDFjYmlBZ2NtVjBkWEp1SUc5bVpuTmxkQ0FySURKY2JuMWNibHh1Wm5WdVkzUnBiMjRnYjJKcVpXTjBWM0pwZEdWVlNXNTBNeklnS0dKMVppd2dkbUZzZFdVc0lHOW1abk5sZEN3Z2JHbDBkR3hsUlc1a2FXRnVLU0I3WEc0Z0lHbG1JQ2gyWVd4MVpTQThJREFwSUhaaGJIVmxJRDBnTUhobVptWm1abVptWmlBcklIWmhiSFZsSUNzZ01WeHVJQ0JtYjNJZ0tIWmhjaUJwSUQwZ01Dd2dhaUE5SUUxaGRHZ3ViV2x1S0dKMVppNXNaVzVuZEdnZ0xTQnZabVp6WlhRc0lEUXBPeUJwSUR3Z2Fqc2dhU3NyS1NCN1hHNGdJQ0FnWW5WbVcyOW1abk5sZENBcklHbGRJRDBnS0haaGJIVmxJRDQrUGlBb2JHbDBkR3hsUlc1a2FXRnVJRDhnYVNBNklETWdMU0JwS1NBcUlEZ3BJQ1lnTUhobVpseHVJQ0I5WEc1OVhHNWNia0oxWm1abGNpNXdjbTkwYjNSNWNHVXVkM0pwZEdWVlNXNTBNekpNUlNBOUlHWjFibU4wYVc5dUlIZHlhWFJsVlVsdWRETXlURVVnS0haaGJIVmxMQ0J2Wm1aelpYUXNJRzV2UVhOelpYSjBLU0I3WEc0Z0lIWmhiSFZsSUQwZ0szWmhiSFZsWEc0Z0lHOW1abk5sZENBOUlHOW1abk5sZENCOElEQmNiaUFnYVdZZ0tDRnViMEZ6YzJWeWRDa2dZMmhsWTJ0SmJuUW9kR2hwY3l3Z2RtRnNkV1VzSUc5bVpuTmxkQ3dnTkN3Z01IaG1abVptWm1abVppd2dNQ2xjYmlBZ2FXWWdLRUoxWm1abGNpNVVXVkJGUkY5QlVsSkJXVjlUVlZCUVQxSlVLU0I3WEc0Z0lDQWdkR2hwYzF0dlptWnpaWFFnS3lBelhTQTlJQ2gyWVd4MVpTQStQajRnTWpRcFhHNGdJQ0FnZEdocGMxdHZabVp6WlhRZ0t5QXlYU0E5SUNoMllXeDFaU0ErUGo0Z01UWXBYRzRnSUNBZ2RHaHBjMXR2Wm1aelpYUWdLeUF4WFNBOUlDaDJZV3gxWlNBK1BqNGdPQ2xjYmlBZ0lDQjBhR2x6VzI5bVpuTmxkRjBnUFNCMllXeDFaVnh1SUNCOUlHVnNjMlVnZTF4dUlDQWdJRzlpYW1WamRGZHlhWFJsVlVsdWRETXlLSFJvYVhNc0lIWmhiSFZsTENCdlptWnpaWFFzSUhSeWRXVXBYRzRnSUgxY2JpQWdjbVYwZFhKdUlHOW1abk5sZENBcklEUmNibjFjYmx4dVFuVm1abVZ5TG5CeWIzUnZkSGx3WlM1M2NtbDBaVlZKYm5Rek1rSkZJRDBnWm5WdVkzUnBiMjRnZDNKcGRHVlZTVzUwTXpKQ1JTQW9kbUZzZFdVc0lHOW1abk5sZEN3Z2JtOUJjM05sY25RcElIdGNiaUFnZG1Gc2RXVWdQU0FyZG1Gc2RXVmNiaUFnYjJabWMyVjBJRDBnYjJabWMyVjBJSHdnTUZ4dUlDQnBaaUFvSVc1dlFYTnpaWEowS1NCamFHVmphMGx1ZENoMGFHbHpMQ0IyWVd4MVpTd2diMlptYzJWMExDQTBMQ0F3ZUdabVptWm1abVptTENBd0tWeHVJQ0JwWmlBb1FuVm1abVZ5TGxSWlVFVkVYMEZTVWtGWlgxTlZVRkJQVWxRcElIdGNiaUFnSUNCMGFHbHpXMjltWm5ObGRGMGdQU0FvZG1Gc2RXVWdQajQrSURJMEtWeHVJQ0FnSUhSb2FYTmJiMlptYzJWMElDc2dNVjBnUFNBb2RtRnNkV1VnUGo0K0lERTJLVnh1SUNBZ0lIUm9hWE5iYjJabWMyVjBJQ3NnTWwwZ1BTQW9kbUZzZFdVZ1BqNCtJRGdwWEc0Z0lDQWdkR2hwYzF0dlptWnpaWFFnS3lBelhTQTlJSFpoYkhWbFhHNGdJSDBnWld4elpTQjdYRzRnSUNBZ2IySnFaV04wVjNKcGRHVlZTVzUwTXpJb2RHaHBjeXdnZG1Gc2RXVXNJRzltWm5ObGRDd2dabUZzYzJVcFhHNGdJSDFjYmlBZ2NtVjBkWEp1SUc5bVpuTmxkQ0FySURSY2JuMWNibHh1UW5WbVptVnlMbkJ5YjNSdmRIbHdaUzUzY21sMFpVbHVkRXhGSUQwZ1puVnVZM1JwYjI0Z2QzSnBkR1ZKYm5STVJTQW9kbUZzZFdVc0lHOW1abk5sZEN3Z1lubDBaVXhsYm1kMGFDd2dibTlCYzNObGNuUXBJSHRjYmlBZ2RtRnNkV1VnUFNBcmRtRnNkV1ZjYmlBZ2IyWm1jMlYwSUQwZ2IyWm1jMlYwSUh3Z01GeHVJQ0JwWmlBb0lXNXZRWE56WlhKMEtTQjdYRzRnSUNBZ2RtRnlJR3hwYldsMElEMGdUV0YwYUM1d2IzY29NaXdnT0NBcUlHSjVkR1ZNWlc1bmRHZ2dMU0F4S1Z4dVhHNGdJQ0FnWTJobFkydEpiblFvZEdocGN5d2dkbUZzZFdVc0lHOW1abk5sZEN3Z1lubDBaVXhsYm1kMGFDd2diR2x0YVhRZ0xTQXhMQ0F0YkdsdGFYUXBYRzRnSUgxY2JseHVJQ0IyWVhJZ2FTQTlJREJjYmlBZ2RtRnlJRzExYkNBOUlERmNiaUFnZG1GeUlITjFZaUE5SUhaaGJIVmxJRHdnTUNBL0lERWdPaUF3WEc0Z0lIUm9hWE5iYjJabWMyVjBYU0E5SUhaaGJIVmxJQ1lnTUhoR1JseHVJQ0IzYUdsc1pTQW9LeXRwSUR3Z1lubDBaVXhsYm1kMGFDQW1KaUFvYlhWc0lDbzlJREI0TVRBd0tTa2dlMXh1SUNBZ0lIUm9hWE5iYjJabWMyVjBJQ3NnYVYwZ1BTQW9LSFpoYkhWbElDOGdiWFZzS1NBK1BpQXdLU0F0SUhOMVlpQW1JREI0UmtaY2JpQWdmVnh1WEc0Z0lISmxkSFZ5YmlCdlptWnpaWFFnS3lCaWVYUmxUR1Z1WjNSb1hHNTlYRzVjYmtKMVptWmxjaTV3Y205MGIzUjVjR1V1ZDNKcGRHVkpiblJDUlNBOUlHWjFibU4wYVc5dUlIZHlhWFJsU1c1MFFrVWdLSFpoYkhWbExDQnZabVp6WlhRc0lHSjVkR1ZNWlc1bmRHZ3NJRzV2UVhOelpYSjBLU0I3WEc0Z0lIWmhiSFZsSUQwZ0szWmhiSFZsWEc0Z0lHOW1abk5sZENBOUlHOW1abk5sZENCOElEQmNiaUFnYVdZZ0tDRnViMEZ6YzJWeWRDa2dlMXh1SUNBZ0lIWmhjaUJzYVcxcGRDQTlJRTFoZEdndWNHOTNLRElzSURnZ0tpQmllWFJsVEdWdVozUm9JQzBnTVNsY2JseHVJQ0FnSUdOb1pXTnJTVzUwS0hSb2FYTXNJSFpoYkhWbExDQnZabVp6WlhRc0lHSjVkR1ZNWlc1bmRHZ3NJR3hwYldsMElDMGdNU3dnTFd4cGJXbDBLVnh1SUNCOVhHNWNiaUFnZG1GeUlHa2dQU0JpZVhSbFRHVnVaM1JvSUMwZ01WeHVJQ0IyWVhJZ2JYVnNJRDBnTVZ4dUlDQjJZWElnYzNWaUlEMGdkbUZzZFdVZ1BDQXdJRDhnTVNBNklEQmNiaUFnZEdocGMxdHZabVp6WlhRZ0t5QnBYU0E5SUhaaGJIVmxJQ1lnTUhoR1JseHVJQ0IzYUdsc1pTQW9MUzFwSUQ0OUlEQWdKaVlnS0cxMWJDQXFQU0F3ZURFd01Da3BJSHRjYmlBZ0lDQjBhR2x6VzI5bVpuTmxkQ0FySUdsZElEMGdLQ2gyWVd4MVpTQXZJRzExYkNrZ1BqNGdNQ2tnTFNCemRXSWdKaUF3ZUVaR1hHNGdJSDFjYmx4dUlDQnlaWFIxY200Z2IyWm1jMlYwSUNzZ1lubDBaVXhsYm1kMGFGeHVmVnh1WEc1Q2RXWm1aWEl1Y0hKdmRHOTBlWEJsTG5keWFYUmxTVzUwT0NBOUlHWjFibU4wYVc5dUlIZHlhWFJsU1c1ME9DQW9kbUZzZFdVc0lHOW1abk5sZEN3Z2JtOUJjM05sY25RcElIdGNiaUFnZG1Gc2RXVWdQU0FyZG1Gc2RXVmNiaUFnYjJabWMyVjBJRDBnYjJabWMyVjBJSHdnTUZ4dUlDQnBaaUFvSVc1dlFYTnpaWEowS1NCamFHVmphMGx1ZENoMGFHbHpMQ0IyWVd4MVpTd2diMlptYzJWMExDQXhMQ0F3ZURkbUxDQXRNSGc0TUNsY2JpQWdhV1lnS0NGQ2RXWm1aWEl1VkZsUVJVUmZRVkpTUVZsZlUxVlFVRTlTVkNrZ2RtRnNkV1VnUFNCTllYUm9MbVpzYjI5eUtIWmhiSFZsS1Z4dUlDQnBaaUFvZG1Gc2RXVWdQQ0F3S1NCMllXeDFaU0E5SURCNFptWWdLeUIyWVd4MVpTQXJJREZjYmlBZ2RHaHBjMXR2Wm1aelpYUmRJRDBnZG1Gc2RXVmNiaUFnY21WMGRYSnVJRzltWm5ObGRDQXJJREZjYm4xY2JseHVRblZtWm1WeUxuQnliM1J2ZEhsd1pTNTNjbWwwWlVsdWRERTJURVVnUFNCbWRXNWpkR2x2YmlCM2NtbDBaVWx1ZERFMlRFVWdLSFpoYkhWbExDQnZabVp6WlhRc0lHNXZRWE56WlhKMEtTQjdYRzRnSUhaaGJIVmxJRDBnSzNaaGJIVmxYRzRnSUc5bVpuTmxkQ0E5SUc5bVpuTmxkQ0I4SURCY2JpQWdhV1lnS0NGdWIwRnpjMlZ5ZENrZ1kyaGxZMnRKYm5Rb2RHaHBjeXdnZG1Gc2RXVXNJRzltWm5ObGRDd2dNaXdnTUhnM1ptWm1MQ0F0TUhnNE1EQXdLVnh1SUNCcFppQW9RblZtWm1WeUxsUlpVRVZFWDBGU1VrRlpYMU5WVUZCUFVsUXBJSHRjYmlBZ0lDQjBhR2x6VzI5bVpuTmxkRjBnUFNCMllXeDFaVnh1SUNBZ0lIUm9hWE5iYjJabWMyVjBJQ3NnTVYwZ1BTQW9kbUZzZFdVZ1BqNCtJRGdwWEc0Z0lIMGdaV3h6WlNCN1hHNGdJQ0FnYjJKcVpXTjBWM0pwZEdWVlNXNTBNVFlvZEdocGN5d2dkbUZzZFdVc0lHOW1abk5sZEN3Z2RISjFaU2xjYmlBZ2ZWeHVJQ0J5WlhSMWNtNGdiMlptYzJWMElDc2dNbHh1ZlZ4dVhHNUNkV1ptWlhJdWNISnZkRzkwZVhCbExuZHlhWFJsU1c1ME1UWkNSU0E5SUdaMWJtTjBhVzl1SUhkeWFYUmxTVzUwTVRaQ1JTQW9kbUZzZFdVc0lHOW1abk5sZEN3Z2JtOUJjM05sY25RcElIdGNiaUFnZG1Gc2RXVWdQU0FyZG1Gc2RXVmNiaUFnYjJabWMyVjBJRDBnYjJabWMyVjBJSHdnTUZ4dUlDQnBaaUFvSVc1dlFYTnpaWEowS1NCamFHVmphMGx1ZENoMGFHbHpMQ0IyWVd4MVpTd2diMlptYzJWMExDQXlMQ0F3ZURkbVptWXNJQzB3ZURnd01EQXBYRzRnSUdsbUlDaENkV1ptWlhJdVZGbFFSVVJmUVZKU1FWbGZVMVZRVUU5U1ZDa2dlMXh1SUNBZ0lIUm9hWE5iYjJabWMyVjBYU0E5SUNoMllXeDFaU0ErUGo0Z09DbGNiaUFnSUNCMGFHbHpXMjltWm5ObGRDQXJJREZkSUQwZ2RtRnNkV1ZjYmlBZ2ZTQmxiSE5sSUh0Y2JpQWdJQ0J2WW1wbFkzUlhjbWwwWlZWSmJuUXhOaWgwYUdsekxDQjJZV3gxWlN3Z2IyWm1jMlYwTENCbVlXeHpaU2xjYmlBZ2ZWeHVJQ0J5WlhSMWNtNGdiMlptYzJWMElDc2dNbHh1ZlZ4dVhHNUNkV1ptWlhJdWNISnZkRzkwZVhCbExuZHlhWFJsU1c1ME16Sk1SU0E5SUdaMWJtTjBhVzl1SUhkeWFYUmxTVzUwTXpKTVJTQW9kbUZzZFdVc0lHOW1abk5sZEN3Z2JtOUJjM05sY25RcElIdGNiaUFnZG1Gc2RXVWdQU0FyZG1Gc2RXVmNiaUFnYjJabWMyVjBJRDBnYjJabWMyVjBJSHdnTUZ4dUlDQnBaaUFvSVc1dlFYTnpaWEowS1NCamFHVmphMGx1ZENoMGFHbHpMQ0IyWVd4MVpTd2diMlptYzJWMExDQTBMQ0F3ZURkbVptWm1abVptTENBdE1IZzRNREF3TURBd01DbGNiaUFnYVdZZ0tFSjFabVpsY2k1VVdWQkZSRjlCVWxKQldWOVRWVkJRVDFKVUtTQjdYRzRnSUNBZ2RHaHBjMXR2Wm1aelpYUmRJRDBnZG1Gc2RXVmNiaUFnSUNCMGFHbHpXMjltWm5ObGRDQXJJREZkSUQwZ0tIWmhiSFZsSUQ0K1BpQTRLVnh1SUNBZ0lIUm9hWE5iYjJabWMyVjBJQ3NnTWwwZ1BTQW9kbUZzZFdVZ1BqNCtJREUyS1Z4dUlDQWdJSFJvYVhOYmIyWm1jMlYwSUNzZ00xMGdQU0FvZG1Gc2RXVWdQajQrSURJMEtWeHVJQ0I5SUdWc2MyVWdlMXh1SUNBZ0lHOWlhbVZqZEZkeWFYUmxWVWx1ZERNeUtIUm9hWE1zSUhaaGJIVmxMQ0J2Wm1aelpYUXNJSFJ5ZFdVcFhHNGdJSDFjYmlBZ2NtVjBkWEp1SUc5bVpuTmxkQ0FySURSY2JuMWNibHh1UW5WbVptVnlMbkJ5YjNSdmRIbHdaUzUzY21sMFpVbHVkRE15UWtVZ1BTQm1kVzVqZEdsdmJpQjNjbWwwWlVsdWRETXlRa1VnS0haaGJIVmxMQ0J2Wm1aelpYUXNJRzV2UVhOelpYSjBLU0I3WEc0Z0lIWmhiSFZsSUQwZ0szWmhiSFZsWEc0Z0lHOW1abk5sZENBOUlHOW1abk5sZENCOElEQmNiaUFnYVdZZ0tDRnViMEZ6YzJWeWRDa2dZMmhsWTJ0SmJuUW9kR2hwY3l3Z2RtRnNkV1VzSUc5bVpuTmxkQ3dnTkN3Z01IZzNabVptWm1abVppd2dMVEI0T0RBd01EQXdNREFwWEc0Z0lHbG1JQ2gyWVd4MVpTQThJREFwSUhaaGJIVmxJRDBnTUhobVptWm1abVptWmlBcklIWmhiSFZsSUNzZ01WeHVJQ0JwWmlBb1FuVm1abVZ5TGxSWlVFVkVYMEZTVWtGWlgxTlZVRkJQVWxRcElIdGNiaUFnSUNCMGFHbHpXMjltWm5ObGRGMGdQU0FvZG1Gc2RXVWdQajQrSURJMEtWeHVJQ0FnSUhSb2FYTmJiMlptYzJWMElDc2dNVjBnUFNBb2RtRnNkV1VnUGo0K0lERTJLVnh1SUNBZ0lIUm9hWE5iYjJabWMyVjBJQ3NnTWwwZ1BTQW9kbUZzZFdVZ1BqNCtJRGdwWEc0Z0lDQWdkR2hwYzF0dlptWnpaWFFnS3lBelhTQTlJSFpoYkhWbFhHNGdJSDBnWld4elpTQjdYRzRnSUNBZ2IySnFaV04wVjNKcGRHVlZTVzUwTXpJb2RHaHBjeXdnZG1Gc2RXVXNJRzltWm5ObGRDd2dabUZzYzJVcFhHNGdJSDFjYmlBZ2NtVjBkWEp1SUc5bVpuTmxkQ0FySURSY2JuMWNibHh1Wm5WdVkzUnBiMjRnWTJobFkydEpSVVZGTnpVMElDaGlkV1lzSUhaaGJIVmxMQ0J2Wm1aelpYUXNJR1Y0ZEN3Z2JXRjRMQ0J0YVc0cElIdGNiaUFnYVdZZ0tIWmhiSFZsSUQ0Z2JXRjRJSHg4SUhaaGJIVmxJRHdnYldsdUtTQjBhSEp2ZHlCdVpYY2dVbUZ1WjJWRmNuSnZjaWduZG1Gc2RXVWdhWE1nYjNWMElHOW1JR0p2ZFc1a2N5Y3BYRzRnSUdsbUlDaHZabVp6WlhRZ0t5QmxlSFFnUGlCaWRXWXViR1Z1WjNSb0tTQjBhSEp2ZHlCdVpYY2dVbUZ1WjJWRmNuSnZjaWduYVc1a1pYZ2diM1YwSUc5bUlISmhibWRsSnlsY2JpQWdhV1lnS0c5bVpuTmxkQ0E4SURBcElIUm9jbTkzSUc1bGR5QlNZVzVuWlVWeWNtOXlLQ2RwYm1SbGVDQnZkWFFnYjJZZ2NtRnVaMlVuS1Z4dWZWeHVYRzVtZFc1amRHbHZiaUIzY21sMFpVWnNiMkYwSUNoaWRXWXNJSFpoYkhWbExDQnZabVp6WlhRc0lHeHBkSFJzWlVWdVpHbGhiaXdnYm05QmMzTmxjblFwSUh0Y2JpQWdhV1lnS0NGdWIwRnpjMlZ5ZENrZ2UxeHVJQ0FnSUdOb1pXTnJTVVZGUlRjMU5DaGlkV1lzSUhaaGJIVmxMQ0J2Wm1aelpYUXNJRFFzSURNdU5EQXlPREl6TkRZMk16ZzFNamc0Tm1Vck16Z3NJQzB6TGpRd01qZ3lNelEyTmpNNE5USTRPRFpsS3pNNEtWeHVJQ0I5WEc0Z0lHbGxaV1UzTlRRdWQzSnBkR1VvWW5WbUxDQjJZV3gxWlN3Z2IyWm1jMlYwTENCc2FYUjBiR1ZGYm1ScFlXNHNJREl6TENBMEtWeHVJQ0J5WlhSMWNtNGdiMlptYzJWMElDc2dORnh1ZlZ4dVhHNUNkV1ptWlhJdWNISnZkRzkwZVhCbExuZHlhWFJsUm14dllYUk1SU0E5SUdaMWJtTjBhVzl1SUhkeWFYUmxSbXh2WVhSTVJTQW9kbUZzZFdVc0lHOW1abk5sZEN3Z2JtOUJjM05sY25RcElIdGNiaUFnY21WMGRYSnVJSGR5YVhSbFJteHZZWFFvZEdocGN5d2dkbUZzZFdVc0lHOW1abk5sZEN3Z2RISjFaU3dnYm05QmMzTmxjblFwWEc1OVhHNWNia0oxWm1abGNpNXdjbTkwYjNSNWNHVXVkM0pwZEdWR2JHOWhkRUpGSUQwZ1puVnVZM1JwYjI0Z2QzSnBkR1ZHYkc5aGRFSkZJQ2gyWVd4MVpTd2diMlptYzJWMExDQnViMEZ6YzJWeWRDa2dlMXh1SUNCeVpYUjFjbTRnZDNKcGRHVkdiRzloZENoMGFHbHpMQ0IyWVd4MVpTd2diMlptYzJWMExDQm1ZV3h6WlN3Z2JtOUJjM05sY25RcFhHNTlYRzVjYm1aMWJtTjBhVzl1SUhkeWFYUmxSRzkxWW14bElDaGlkV1lzSUhaaGJIVmxMQ0J2Wm1aelpYUXNJR3hwZEhSc1pVVnVaR2xoYml3Z2JtOUJjM05sY25RcElIdGNiaUFnYVdZZ0tDRnViMEZ6YzJWeWRDa2dlMXh1SUNBZ0lHTm9aV05yU1VWRlJUYzFOQ2hpZFdZc0lIWmhiSFZsTENCdlptWnpaWFFzSURnc0lERXVOemszTmprek1UTTBPRFl5TXpFMU4wVXJNekE0TENBdE1TNDNPVGMyT1RNeE16UTROakl6TVRVM1JTc3pNRGdwWEc0Z0lIMWNiaUFnYVdWbFpUYzFOQzUzY21sMFpTaGlkV1lzSUhaaGJIVmxMQ0J2Wm1aelpYUXNJR3hwZEhSc1pVVnVaR2xoYml3Z05USXNJRGdwWEc0Z0lISmxkSFZ5YmlCdlptWnpaWFFnS3lBNFhHNTlYRzVjYmtKMVptWmxjaTV3Y205MGIzUjVjR1V1ZDNKcGRHVkViM1ZpYkdWTVJTQTlJR1oxYm1OMGFXOXVJSGR5YVhSbFJHOTFZbXhsVEVVZ0tIWmhiSFZsTENCdlptWnpaWFFzSUc1dlFYTnpaWEowS1NCN1hHNGdJSEpsZEhWeWJpQjNjbWwwWlVSdmRXSnNaU2gwYUdsekxDQjJZV3gxWlN3Z2IyWm1jMlYwTENCMGNuVmxMQ0J1YjBGemMyVnlkQ2xjYm4xY2JseHVRblZtWm1WeUxuQnliM1J2ZEhsd1pTNTNjbWwwWlVSdmRXSnNaVUpGSUQwZ1puVnVZM1JwYjI0Z2QzSnBkR1ZFYjNWaWJHVkNSU0FvZG1Gc2RXVXNJRzltWm5ObGRDd2dibTlCYzNObGNuUXBJSHRjYmlBZ2NtVjBkWEp1SUhkeWFYUmxSRzkxWW14bEtIUm9hWE1zSUhaaGJIVmxMQ0J2Wm1aelpYUXNJR1poYkhObExDQnViMEZ6YzJWeWRDbGNibjFjYmx4dUx5OGdZMjl3ZVNoMFlYSm5aWFJDZFdabVpYSXNJSFJoY21kbGRGTjBZWEowUFRBc0lITnZkWEpqWlZOMFlYSjBQVEFzSUhOdmRYSmpaVVZ1WkQxaWRXWm1aWEl1YkdWdVozUm9LVnh1UW5WbVptVnlMbkJ5YjNSdmRIbHdaUzVqYjNCNUlEMGdablZ1WTNScGIyNGdZMjl3ZVNBb2RHRnlaMlYwTENCMFlYSm5aWFJUZEdGeWRDd2djM1JoY25Rc0lHVnVaQ2tnZTF4dUlDQnBaaUFvSVhOMFlYSjBLU0J6ZEdGeWRDQTlJREJjYmlBZ2FXWWdLQ0ZsYm1RZ0ppWWdaVzVrSUNFOVBTQXdLU0JsYm1RZ1BTQjBhR2x6TG14bGJtZDBhRnh1SUNCcFppQW9kR0Z5WjJWMFUzUmhjblFnUGowZ2RHRnlaMlYwTG14bGJtZDBhQ2tnZEdGeVoyVjBVM1JoY25RZ1BTQjBZWEpuWlhRdWJHVnVaM1JvWEc0Z0lHbG1JQ2doZEdGeVoyVjBVM1JoY25RcElIUmhjbWRsZEZOMFlYSjBJRDBnTUZ4dUlDQnBaaUFvWlc1a0lENGdNQ0FtSmlCbGJtUWdQQ0J6ZEdGeWRDa2daVzVrSUQwZ2MzUmhjblJjYmx4dUlDQXZMeUJEYjNCNUlEQWdZbmwwWlhNN0lIZGxKM0psSUdSdmJtVmNiaUFnYVdZZ0tHVnVaQ0E5UFQwZ2MzUmhjblFwSUhKbGRIVnliaUF3WEc0Z0lHbG1JQ2gwWVhKblpYUXViR1Z1WjNSb0lEMDlQU0F3SUh4OElIUm9hWE11YkdWdVozUm9JRDA5UFNBd0tTQnlaWFIxY200Z01GeHVYRzRnSUM4dklFWmhkR0ZzSUdWeWNtOXlJR052Ym1ScGRHbHZibk5jYmlBZ2FXWWdLSFJoY21kbGRGTjBZWEowSUR3Z01Da2dlMXh1SUNBZ0lIUm9jbTkzSUc1bGR5QlNZVzVuWlVWeWNtOXlLQ2QwWVhKblpYUlRkR0Z5ZENCdmRYUWdiMllnWW05MWJtUnpKeWxjYmlBZ2ZWeHVJQ0JwWmlBb2MzUmhjblFnUENBd0lIeDhJSE4wWVhKMElENDlJSFJvYVhNdWJHVnVaM1JvS1NCMGFISnZkeUJ1WlhjZ1VtRnVaMlZGY25KdmNpZ25jMjkxY21ObFUzUmhjblFnYjNWMElHOW1JR0p2ZFc1a2N5Y3BYRzRnSUdsbUlDaGxibVFnUENBd0tTQjBhSEp2ZHlCdVpYY2dVbUZ1WjJWRmNuSnZjaWduYzI5MWNtTmxSVzVrSUc5MWRDQnZaaUJpYjNWdVpITW5LVnh1WEc0Z0lDOHZJRUZ5WlNCM1pTQnZiMkkvWEc0Z0lHbG1JQ2hsYm1RZ1BpQjBhR2x6TG14bGJtZDBhQ2tnWlc1a0lEMGdkR2hwY3k1c1pXNW5kR2hjYmlBZ2FXWWdLSFJoY21kbGRDNXNaVzVuZEdnZ0xTQjBZWEpuWlhSVGRHRnlkQ0E4SUdWdVpDQXRJSE4wWVhKMEtTQjdYRzRnSUNBZ1pXNWtJRDBnZEdGeVoyVjBMbXhsYm1kMGFDQXRJSFJoY21kbGRGTjBZWEowSUNzZ2MzUmhjblJjYmlBZ2ZWeHVYRzRnSUhaaGNpQnNaVzRnUFNCbGJtUWdMU0J6ZEdGeWRGeHVJQ0IyWVhJZ2FWeHVYRzRnSUdsbUlDaDBhR2x6SUQwOVBTQjBZWEpuWlhRZ0ppWWdjM1JoY25RZ1BDQjBZWEpuWlhSVGRHRnlkQ0FtSmlCMFlYSm5aWFJUZEdGeWRDQThJR1Z1WkNrZ2UxeHVJQ0FnSUM4dklHUmxjMk5sYm1ScGJtY2dZMjl3ZVNCbWNtOXRJR1Z1WkZ4dUlDQWdJR1p2Y2lBb2FTQTlJR3hsYmlBdElERTdJR2tnUGowZ01Ec2dhUzB0S1NCN1hHNGdJQ0FnSUNCMFlYSm5aWFJiYVNBcklIUmhjbWRsZEZOMFlYSjBYU0E5SUhSb2FYTmJhU0FySUhOMFlYSjBYVnh1SUNBZ0lIMWNiaUFnZlNCbGJITmxJR2xtSUNoc1pXNGdQQ0F4TURBd0lIeDhJQ0ZDZFdabVpYSXVWRmxRUlVSZlFWSlNRVmxmVTFWUVVFOVNWQ2tnZTF4dUlDQWdJQzh2SUdGelkyVnVaR2x1WnlCamIzQjVJR1p5YjIwZ2MzUmhjblJjYmlBZ0lDQm1iM0lnS0drZ1BTQXdPeUJwSUR3Z2JHVnVPeUJwS3lzcElIdGNiaUFnSUNBZ0lIUmhjbWRsZEZ0cElDc2dkR0Z5WjJWMFUzUmhjblJkSUQwZ2RHaHBjMXRwSUNzZ2MzUmhjblJkWEc0Z0lDQWdmVnh1SUNCOUlHVnNjMlVnZTF4dUlDQWdJSFJoY21kbGRDNWZjMlYwS0hSb2FYTXVjM1ZpWVhKeVlYa29jM1JoY25Rc0lITjBZWEowSUNzZ2JHVnVLU3dnZEdGeVoyVjBVM1JoY25RcFhHNGdJSDFjYmx4dUlDQnlaWFIxY200Z2JHVnVYRzU5WEc1Y2JpOHZJR1pwYkd3b2RtRnNkV1VzSUhOMFlYSjBQVEFzSUdWdVpEMWlkV1ptWlhJdWJHVnVaM1JvS1Z4dVFuVm1abVZ5TG5CeWIzUnZkSGx3WlM1bWFXeHNJRDBnWm5WdVkzUnBiMjRnWm1sc2JDQW9kbUZzZFdVc0lITjBZWEowTENCbGJtUXBJSHRjYmlBZ2FXWWdLQ0YyWVd4MVpTa2dkbUZzZFdVZ1BTQXdYRzRnSUdsbUlDZ2hjM1JoY25RcElITjBZWEowSUQwZ01GeHVJQ0JwWmlBb0lXVnVaQ2tnWlc1a0lEMGdkR2hwY3k1c1pXNW5kR2hjYmx4dUlDQnBaaUFvWlc1a0lEd2djM1JoY25RcElIUm9jbTkzSUc1bGR5QlNZVzVuWlVWeWNtOXlLQ2RsYm1RZ1BDQnpkR0Z5ZENjcFhHNWNiaUFnTHk4Z1JtbHNiQ0F3SUdKNWRHVnpPeUIzWlNkeVpTQmtiMjVsWEc0Z0lHbG1JQ2hsYm1RZ1BUMDlJSE4wWVhKMEtTQnlaWFIxY201Y2JpQWdhV1lnS0hSb2FYTXViR1Z1WjNSb0lEMDlQU0F3S1NCeVpYUjFjbTVjYmx4dUlDQnBaaUFvYzNSaGNuUWdQQ0F3SUh4OElITjBZWEowSUQ0OUlIUm9hWE11YkdWdVozUm9LU0IwYUhKdmR5QnVaWGNnVW1GdVoyVkZjbkp2Y2lnbmMzUmhjblFnYjNWMElHOW1JR0p2ZFc1a2N5Y3BYRzRnSUdsbUlDaGxibVFnUENBd0lIeDhJR1Z1WkNBK0lIUm9hWE11YkdWdVozUm9LU0IwYUhKdmR5QnVaWGNnVW1GdVoyVkZjbkp2Y2lnblpXNWtJRzkxZENCdlppQmliM1Z1WkhNbktWeHVYRzRnSUhaaGNpQnBYRzRnSUdsbUlDaDBlWEJsYjJZZ2RtRnNkV1VnUFQwOUlDZHVkVzFpWlhJbktTQjdYRzRnSUNBZ1ptOXlJQ2hwSUQwZ2MzUmhjblE3SUdrZ1BDQmxibVE3SUdrckt5a2dlMXh1SUNBZ0lDQWdkR2hwYzF0cFhTQTlJSFpoYkhWbFhHNGdJQ0FnZlZ4dUlDQjlJR1ZzYzJVZ2UxeHVJQ0FnSUhaaGNpQmllWFJsY3lBOUlIVjBaamhVYjBKNWRHVnpLSFpoYkhWbExuUnZVM1J5YVc1bktDa3BYRzRnSUNBZ2RtRnlJR3hsYmlBOUlHSjVkR1Z6TG14bGJtZDBhRnh1SUNBZ0lHWnZjaUFvYVNBOUlITjBZWEowT3lCcElEd2daVzVrT3lCcEt5c3BJSHRjYmlBZ0lDQWdJSFJvYVhOYmFWMGdQU0JpZVhSbGMxdHBJQ1VnYkdWdVhWeHVJQ0FnSUgxY2JpQWdmVnh1WEc0Z0lISmxkSFZ5YmlCMGFHbHpYRzU5WEc1Y2JpOHFLbHh1SUNvZ1EzSmxZWFJsY3lCaElHNWxkeUJnUVhKeVlYbENkV1ptWlhKZ0lIZHBkR2dnZEdobElDcGpiM0JwWldRcUlHMWxiVzl5ZVNCdlppQjBhR1VnWW5WbVptVnlJR2x1YzNSaGJtTmxMbHh1SUNvZ1FXUmtaV1FnYVc0Z1RtOWtaU0F3TGpFeUxpQlBibXg1SUdGMllXbHNZV0pzWlNCcGJpQmljbTkzYzJWeWN5QjBhR0YwSUhOMWNIQnZjblFnUVhKeVlYbENkV1ptWlhJdVhHNGdLaTljYmtKMVptWmxjaTV3Y205MGIzUjVjR1V1ZEc5QmNuSmhlVUoxWm1abGNpQTlJR1oxYm1OMGFXOXVJSFJ2UVhKeVlYbENkV1ptWlhJZ0tDa2dlMXh1SUNCcFppQW9kSGx3Wlc5bUlGVnBiblE0UVhKeVlYa2dJVDA5SUNkMWJtUmxabWx1WldRbktTQjdYRzRnSUNBZ2FXWWdLRUoxWm1abGNpNVVXVkJGUkY5QlVsSkJXVjlUVlZCUVQxSlVLU0I3WEc0Z0lDQWdJQ0J5WlhSMWNtNGdLRzVsZHlCQ2RXWm1aWElvZEdocGN5a3BMbUoxWm1abGNseHVJQ0FnSUgwZ1pXeHpaU0I3WEc0Z0lDQWdJQ0IyWVhJZ1luVm1JRDBnYm1WM0lGVnBiblE0UVhKeVlYa29kR2hwY3k1c1pXNW5kR2dwWEc0Z0lDQWdJQ0JtYjNJZ0tIWmhjaUJwSUQwZ01Dd2diR1Z1SUQwZ1luVm1MbXhsYm1kMGFEc2dhU0E4SUd4bGJqc2dhU0FyUFNBeEtTQjdYRzRnSUNBZ0lDQWdJR0oxWmx0cFhTQTlJSFJvYVhOYmFWMWNiaUFnSUNBZ0lIMWNiaUFnSUNBZ0lISmxkSFZ5YmlCaWRXWXVZblZtWm1WeVhHNGdJQ0FnZlZ4dUlDQjlJR1ZzYzJVZ2UxeHVJQ0FnSUhSb2NtOTNJRzVsZHlCVWVYQmxSWEp5YjNJb0owSjFabVpsY2k1MGIwRnljbUY1UW5WbVptVnlJRzV2ZENCemRYQndiM0owWldRZ2FXNGdkR2hwY3lCaWNtOTNjMlZ5SnlsY2JpQWdmVnh1ZlZ4dVhHNHZMeUJJUlV4UVJWSWdSbFZPUTFSSlQwNVRYRzR2THlBOVBUMDlQVDA5UFQwOVBUMDlQVDA5WEc1Y2JuWmhjaUJDVUNBOUlFSjFabVpsY2k1d2NtOTBiM1I1Y0dWY2JseHVMeW9xWEc0Z0tpQkJkV2R0Wlc1MElHRWdWV2x1ZERoQmNuSmhlU0FxYVc1emRHRnVZMlVxSUNodWIzUWdkR2hsSUZWcGJuUTRRWEp5WVhrZ1kyeGhjM01oS1NCM2FYUm9JRUoxWm1abGNpQnRaWFJvYjJSelhHNGdLaTljYmtKMVptWmxjaTVmWVhWbmJXVnVkQ0E5SUdaMWJtTjBhVzl1SUY5aGRXZHRaVzUwSUNoaGNuSXBJSHRjYmlBZ1lYSnlMbU52Ym5OMGNuVmpkRzl5SUQwZ1FuVm1abVZ5WEc0Z0lHRnljaTVmYVhOQ2RXWm1aWElnUFNCMGNuVmxYRzVjYmlBZ0x5OGdjMkYyWlNCeVpXWmxjbVZ1WTJVZ2RHOGdiM0pwWjJsdVlXd2dWV2x1ZERoQmNuSmhlU0J6WlhRZ2JXVjBhRzlrSUdKbFptOXlaU0J2ZG1WeWQzSnBkR2x1WjF4dUlDQmhjbkl1WDNObGRDQTlJR0Z5Y2k1elpYUmNibHh1SUNBdkx5QmtaWEJ5WldOaGRHVmtYRzRnSUdGeWNpNW5aWFFnUFNCQ1VDNW5aWFJjYmlBZ1lYSnlMbk5sZENBOUlFSlFMbk5sZEZ4dVhHNGdJR0Z5Y2k1M2NtbDBaU0E5SUVKUUxuZHlhWFJsWEc0Z0lHRnljaTUwYjFOMGNtbHVaeUE5SUVKUUxuUnZVM1J5YVc1blhHNGdJR0Z5Y2k1MGIweHZZMkZzWlZOMGNtbHVaeUE5SUVKUUxuUnZVM1J5YVc1blhHNGdJR0Z5Y2k1MGIwcFRUMDRnUFNCQ1VDNTBiMHBUVDA1Y2JpQWdZWEp5TG1WeGRXRnNjeUE5SUVKUUxtVnhkV0ZzYzF4dUlDQmhjbkl1WTI5dGNHRnlaU0E5SUVKUUxtTnZiWEJoY21WY2JpQWdZWEp5TG1sdVpHVjRUMllnUFNCQ1VDNXBibVJsZUU5bVhHNGdJR0Z5Y2k1amIzQjVJRDBnUWxBdVkyOXdlVnh1SUNCaGNuSXVjMnhwWTJVZ1BTQkNVQzV6YkdsalpWeHVJQ0JoY25JdWNtVmhaRlZKYm5STVJTQTlJRUpRTG5KbFlXUlZTVzUwVEVWY2JpQWdZWEp5TG5KbFlXUlZTVzUwUWtVZ1BTQkNVQzV5WldGa1ZVbHVkRUpGWEc0Z0lHRnljaTV5WldGa1ZVbHVkRGdnUFNCQ1VDNXlaV0ZrVlVsdWREaGNiaUFnWVhKeUxuSmxZV1JWU1c1ME1UWk1SU0E5SUVKUUxuSmxZV1JWU1c1ME1UWk1SVnh1SUNCaGNuSXVjbVZoWkZWSmJuUXhOa0pGSUQwZ1FsQXVjbVZoWkZWSmJuUXhOa0pGWEc0Z0lHRnljaTV5WldGa1ZVbHVkRE15VEVVZ1BTQkNVQzV5WldGa1ZVbHVkRE15VEVWY2JpQWdZWEp5TG5KbFlXUlZTVzUwTXpKQ1JTQTlJRUpRTG5KbFlXUlZTVzUwTXpKQ1JWeHVJQ0JoY25JdWNtVmhaRWx1ZEV4RklEMGdRbEF1Y21WaFpFbHVkRXhGWEc0Z0lHRnljaTV5WldGa1NXNTBRa1VnUFNCQ1VDNXlaV0ZrU1c1MFFrVmNiaUFnWVhKeUxuSmxZV1JKYm5RNElEMGdRbEF1Y21WaFpFbHVkRGhjYmlBZ1lYSnlMbkpsWVdSSmJuUXhOa3hGSUQwZ1FsQXVjbVZoWkVsdWRERTJURVZjYmlBZ1lYSnlMbkpsWVdSSmJuUXhOa0pGSUQwZ1FsQXVjbVZoWkVsdWRERTJRa1ZjYmlBZ1lYSnlMbkpsWVdSSmJuUXpNa3hGSUQwZ1FsQXVjbVZoWkVsdWRETXlURVZjYmlBZ1lYSnlMbkpsWVdSSmJuUXpNa0pGSUQwZ1FsQXVjbVZoWkVsdWRETXlRa1ZjYmlBZ1lYSnlMbkpsWVdSR2JHOWhkRXhGSUQwZ1FsQXVjbVZoWkVac2IyRjBURVZjYmlBZ1lYSnlMbkpsWVdSR2JHOWhkRUpGSUQwZ1FsQXVjbVZoWkVac2IyRjBRa1ZjYmlBZ1lYSnlMbkpsWVdSRWIzVmliR1ZNUlNBOUlFSlFMbkpsWVdSRWIzVmliR1ZNUlZ4dUlDQmhjbkl1Y21WaFpFUnZkV0pzWlVKRklEMGdRbEF1Y21WaFpFUnZkV0pzWlVKRlhHNGdJR0Z5Y2k1M2NtbDBaVlZKYm5RNElEMGdRbEF1ZDNKcGRHVlZTVzUwT0Z4dUlDQmhjbkl1ZDNKcGRHVlZTVzUwVEVVZ1BTQkNVQzUzY21sMFpWVkpiblJNUlZ4dUlDQmhjbkl1ZDNKcGRHVlZTVzUwUWtVZ1BTQkNVQzUzY21sMFpWVkpiblJDUlZ4dUlDQmhjbkl1ZDNKcGRHVlZTVzUwTVRaTVJTQTlJRUpRTG5keWFYUmxWVWx1ZERFMlRFVmNiaUFnWVhKeUxuZHlhWFJsVlVsdWRERTJRa1VnUFNCQ1VDNTNjbWwwWlZWSmJuUXhOa0pGWEc0Z0lHRnljaTUzY21sMFpWVkpiblF6TWt4RklEMGdRbEF1ZDNKcGRHVlZTVzUwTXpKTVJWeHVJQ0JoY25JdWQzSnBkR1ZWU1c1ME16SkNSU0E5SUVKUUxuZHlhWFJsVlVsdWRETXlRa1ZjYmlBZ1lYSnlMbmR5YVhSbFNXNTBURVVnUFNCQ1VDNTNjbWwwWlVsdWRFeEZYRzRnSUdGeWNpNTNjbWwwWlVsdWRFSkZJRDBnUWxBdWQzSnBkR1ZKYm5SQ1JWeHVJQ0JoY25JdWQzSnBkR1ZKYm5RNElEMGdRbEF1ZDNKcGRHVkpiblE0WEc0Z0lHRnljaTUzY21sMFpVbHVkREUyVEVVZ1BTQkNVQzUzY21sMFpVbHVkREUyVEVWY2JpQWdZWEp5TG5keWFYUmxTVzUwTVRaQ1JTQTlJRUpRTG5keWFYUmxTVzUwTVRaQ1JWeHVJQ0JoY25JdWQzSnBkR1ZKYm5Rek1reEZJRDBnUWxBdWQzSnBkR1ZKYm5Rek1reEZYRzRnSUdGeWNpNTNjbWwwWlVsdWRETXlRa1VnUFNCQ1VDNTNjbWwwWlVsdWRETXlRa1ZjYmlBZ1lYSnlMbmR5YVhSbFJteHZZWFJNUlNBOUlFSlFMbmR5YVhSbFJteHZZWFJNUlZ4dUlDQmhjbkl1ZDNKcGRHVkdiRzloZEVKRklEMGdRbEF1ZDNKcGRHVkdiRzloZEVKRlhHNGdJR0Z5Y2k1M2NtbDBaVVJ2ZFdKc1pVeEZJRDBnUWxBdWQzSnBkR1ZFYjNWaWJHVk1SVnh1SUNCaGNuSXVkM0pwZEdWRWIzVmliR1ZDUlNBOUlFSlFMbmR5YVhSbFJHOTFZbXhsUWtWY2JpQWdZWEp5TG1acGJHd2dQU0JDVUM1bWFXeHNYRzRnSUdGeWNpNXBibk53WldOMElEMGdRbEF1YVc1emNHVmpkRnh1SUNCaGNuSXVkRzlCY25KaGVVSjFabVpsY2lBOUlFSlFMblJ2UVhKeVlYbENkV1ptWlhKY2JseHVJQ0J5WlhSMWNtNGdZWEp5WEc1OVhHNWNiblpoY2lCSlRsWkJURWxFWDBKQlUwVTJORjlTUlNBOUlDOWJYaXRjWEM4d0xUbEJMVnBoTFhvdFgxMHZaMXh1WEc1bWRXNWpkR2x2YmlCaVlYTmxOalJqYkdWaGJpQW9jM1J5S1NCN1hHNGdJQzh2SUU1dlpHVWdjM1J5YVhCeklHOTFkQ0JwYm5aaGJHbGtJR05vWVhKaFkzUmxjbk1nYkdsclpTQmNYRzRnWVc1a0lGeGNkQ0JtY205dElIUm9aU0J6ZEhKcGJtY3NJR0poYzJVMk5DMXFjeUJrYjJWeklHNXZkRnh1SUNCemRISWdQU0J6ZEhKcGJtZDBjbWx0S0hOMGNpa3VjbVZ3YkdGalpTaEpUbFpCVEVsRVgwSkJVMFUyTkY5U1JTd2dKeWNwWEc0Z0lDOHZJRTV2WkdVZ1kyOXVkbVZ5ZEhNZ2MzUnlhVzVuY3lCM2FYUm9JR3hsYm1kMGFDQThJRElnZEc4Z0p5ZGNiaUFnYVdZZ0tITjBjaTVzWlc1bmRHZ2dQQ0F5S1NCeVpYUjFjbTRnSnlkY2JpQWdMeThnVG05a1pTQmhiR3h2ZDNNZ1ptOXlJRzV2Ymkxd1lXUmtaV1FnWW1GelpUWTBJSE4wY21sdVozTWdLRzFwYzNOcGJtY2dkSEpoYVd4cGJtY2dQVDA5S1N3Z1ltRnpaVFkwTFdweklHUnZaWE1nYm05MFhHNGdJSGRvYVd4bElDaHpkSEl1YkdWdVozUm9JQ1VnTkNBaFBUMGdNQ2tnZTF4dUlDQWdJSE4wY2lBOUlITjBjaUFySUNjOUoxeHVJQ0I5WEc0Z0lISmxkSFZ5YmlCemRISmNibjFjYmx4dVpuVnVZM1JwYjI0Z2MzUnlhVzVuZEhKcGJTQW9jM1J5S1NCN1hHNGdJR2xtSUNoemRISXVkSEpwYlNrZ2NtVjBkWEp1SUhOMGNpNTBjbWx0S0NsY2JpQWdjbVYwZFhKdUlITjBjaTV5WlhCc1lXTmxLQzllWEZ4ekszeGNYSE1ySkM5bkxDQW5KeWxjYm4xY2JseHVablZ1WTNScGIyNGdkRzlJWlhnZ0tHNHBJSHRjYmlBZ2FXWWdLRzRnUENBeE5pa2djbVYwZFhKdUlDY3dKeUFySUc0dWRHOVRkSEpwYm1jb01UWXBYRzRnSUhKbGRIVnliaUJ1TG5SdlUzUnlhVzVuS0RFMktWeHVmVnh1WEc1bWRXNWpkR2x2YmlCMWRHWTRWRzlDZVhSbGN5QW9jM1J5YVc1bkxDQjFibWwwY3lrZ2UxeHVJQ0IxYm1sMGN5QTlJSFZ1YVhSeklIeDhJRWx1Wm1sdWFYUjVYRzRnSUhaaGNpQmpiMlJsVUc5cGJuUmNiaUFnZG1GeUlHeGxibWQwYUNBOUlITjBjbWx1Wnk1c1pXNW5kR2hjYmlBZ2RtRnlJR3hsWVdSVGRYSnliMmRoZEdVZ1BTQnVkV3hzWEc0Z0lIWmhjaUJpZVhSbGN5QTlJRnRkWEc0Z0lIWmhjaUJwSUQwZ01GeHVYRzRnSUdadmNpQW9PeUJwSUR3Z2JHVnVaM1JvT3lCcEt5c3BJSHRjYmlBZ0lDQmpiMlJsVUc5cGJuUWdQU0J6ZEhKcGJtY3VZMmhoY2tOdlpHVkJkQ2hwS1Z4dVhHNGdJQ0FnTHk4Z2FYTWdjM1Z5Y205bllYUmxJR052YlhCdmJtVnVkRnh1SUNBZ0lHbG1JQ2hqYjJSbFVHOXBiblFnUGlBd2VFUTNSa1lnSmlZZ1kyOWtaVkJ2YVc1MElEd2dNSGhGTURBd0tTQjdYRzRnSUNBZ0lDQXZMeUJzWVhOMElHTm9ZWElnZDJGeklHRWdiR1ZoWkZ4dUlDQWdJQ0FnYVdZZ0tHeGxZV1JUZFhKeWIyZGhkR1VwSUh0Y2JpQWdJQ0FnSUNBZ0x5OGdNaUJzWldGa2N5QnBiaUJoSUhKdmQxeHVJQ0FnSUNBZ0lDQnBaaUFvWTI5a1pWQnZhVzUwSUR3Z01IaEVRekF3S1NCN1hHNGdJQ0FnSUNBZ0lDQWdhV1lnS0NoMWJtbDBjeUF0UFNBektTQStJQzB4S1NCaWVYUmxjeTV3ZFhOb0tEQjRSVVlzSURCNFFrWXNJREI0UWtRcFhHNGdJQ0FnSUNBZ0lDQWdiR1ZoWkZOMWNuSnZaMkYwWlNBOUlHTnZaR1ZRYjJsdWRGeHVJQ0FnSUNBZ0lDQWdJR052Ym5ScGJuVmxYRzRnSUNBZ0lDQWdJSDBnWld4elpTQjdYRzRnSUNBZ0lDQWdJQ0FnTHk4Z2RtRnNhV1FnYzNWeWNtOW5ZWFJsSUhCaGFYSmNiaUFnSUNBZ0lDQWdJQ0JqYjJSbFVHOXBiblFnUFNCc1pXRmtVM1Z5Y205bllYUmxJQzBnTUhoRU9EQXdJRHc4SURFd0lId2dZMjlrWlZCdmFXNTBJQzBnTUhoRVF6QXdJSHdnTUhneE1EQXdNRnh1SUNBZ0lDQWdJQ0FnSUd4bFlXUlRkWEp5YjJkaGRHVWdQU0J1ZFd4c1hHNGdJQ0FnSUNBZ0lIMWNiaUFnSUNBZ0lIMGdaV3h6WlNCN1hHNGdJQ0FnSUNBZ0lDOHZJRzV2SUd4bFlXUWdlV1YwWEc1Y2JpQWdJQ0FnSUNBZ2FXWWdLR052WkdWUWIybHVkQ0ErSURCNFJFSkdSaWtnZTF4dUlDQWdJQ0FnSUNBZ0lDOHZJSFZ1Wlhod1pXTjBaV1FnZEhKaGFXeGNiaUFnSUNBZ0lDQWdJQ0JwWmlBb0tIVnVhWFJ6SUMwOUlETXBJRDRnTFRFcElHSjVkR1Z6TG5CMWMyZ29NSGhGUml3Z01IaENSaXdnTUhoQ1JDbGNiaUFnSUNBZ0lDQWdJQ0JqYjI1MGFXNTFaVnh1SUNBZ0lDQWdJQ0I5SUdWc2MyVWdhV1lnS0drZ0t5QXhJRDA5UFNCc1pXNW5kR2dwSUh0Y2JpQWdJQ0FnSUNBZ0lDQXZMeUIxYm5CaGFYSmxaQ0JzWldGa1hHNGdJQ0FnSUNBZ0lDQWdhV1lnS0NoMWJtbDBjeUF0UFNBektTQStJQzB4S1NCaWVYUmxjeTV3ZFhOb0tEQjRSVVlzSURCNFFrWXNJREI0UWtRcFhHNGdJQ0FnSUNBZ0lDQWdZMjl1ZEdsdWRXVmNiaUFnSUNBZ0lDQWdmU0JsYkhObElIdGNiaUFnSUNBZ0lDQWdJQ0F2THlCMllXeHBaQ0JzWldGa1hHNGdJQ0FnSUNBZ0lDQWdiR1ZoWkZOMWNuSnZaMkYwWlNBOUlHTnZaR1ZRYjJsdWRGeHVJQ0FnSUNBZ0lDQWdJR052Ym5ScGJuVmxYRzRnSUNBZ0lDQWdJSDFjYmlBZ0lDQWdJSDFjYmlBZ0lDQjlJR1ZzYzJVZ2FXWWdLR3hsWVdSVGRYSnliMmRoZEdVcElIdGNiaUFnSUNBZ0lDOHZJSFpoYkdsa0lHSnRjQ0JqYUdGeUxDQmlkWFFnYkdGemRDQmphR0Z5SUhkaGN5QmhJR3hsWVdSY2JpQWdJQ0FnSUdsbUlDZ29kVzVwZEhNZ0xUMGdNeWtnUGlBdE1Ta2dZbmwwWlhNdWNIVnphQ2d3ZUVWR0xDQXdlRUpHTENBd2VFSkVLVnh1SUNBZ0lDQWdiR1ZoWkZOMWNuSnZaMkYwWlNBOUlHNTFiR3hjYmlBZ0lDQjlYRzVjYmlBZ0lDQXZMeUJsYm1OdlpHVWdkWFJtT0Z4dUlDQWdJR2xtSUNoamIyUmxVRzlwYm5RZ1BDQXdlRGd3S1NCN1hHNGdJQ0FnSUNCcFppQW9LSFZ1YVhSeklDMDlJREVwSUR3Z01Da2dZbkpsWVd0Y2JpQWdJQ0FnSUdKNWRHVnpMbkIxYzJnb1kyOWtaVkJ2YVc1MEtWeHVJQ0FnSUgwZ1pXeHpaU0JwWmlBb1kyOWtaVkJ2YVc1MElEd2dNSGc0TURBcElIdGNiaUFnSUNBZ0lHbG1JQ2dvZFc1cGRITWdMVDBnTWlrZ1BDQXdLU0JpY21WaGExeHVJQ0FnSUNBZ1lubDBaWE11Y0hWemFDaGNiaUFnSUNBZ0lDQWdZMjlrWlZCdmFXNTBJRDQrSURCNE5pQjhJREI0UXpBc1hHNGdJQ0FnSUNBZ0lHTnZaR1ZRYjJsdWRDQW1JREI0TTBZZ2ZDQXdlRGd3WEc0Z0lDQWdJQ0FwWEc0Z0lDQWdmU0JsYkhObElHbG1JQ2hqYjJSbFVHOXBiblFnUENBd2VERXdNREF3S1NCN1hHNGdJQ0FnSUNCcFppQW9LSFZ1YVhSeklDMDlJRE1wSUR3Z01Da2dZbkpsWVd0Y2JpQWdJQ0FnSUdKNWRHVnpMbkIxYzJnb1hHNGdJQ0FnSUNBZ0lHTnZaR1ZRYjJsdWRDQStQaUF3ZUVNZ2ZDQXdlRVV3TEZ4dUlDQWdJQ0FnSUNCamIyUmxVRzlwYm5RZ1BqNGdNSGcySUNZZ01IZ3pSaUI4SURCNE9EQXNYRzRnSUNBZ0lDQWdJR052WkdWUWIybHVkQ0FtSURCNE0wWWdmQ0F3ZURnd1hHNGdJQ0FnSUNBcFhHNGdJQ0FnZlNCbGJITmxJR2xtSUNoamIyUmxVRzlwYm5RZ1BDQXdlREl3TURBd01Da2dlMXh1SUNBZ0lDQWdhV1lnS0NoMWJtbDBjeUF0UFNBMEtTQThJREFwSUdKeVpXRnJYRzRnSUNBZ0lDQmllWFJsY3k1d2RYTm9LRnh1SUNBZ0lDQWdJQ0JqYjJSbFVHOXBiblFnUGo0Z01IZ3hNaUI4SURCNFJqQXNYRzRnSUNBZ0lDQWdJR052WkdWUWIybHVkQ0ErUGlBd2VFTWdKaUF3ZUROR0lId2dNSGc0TUN4Y2JpQWdJQ0FnSUNBZ1kyOWtaVkJ2YVc1MElENCtJREI0TmlBbUlEQjRNMFlnZkNBd2VEZ3dMRnh1SUNBZ0lDQWdJQ0JqYjJSbFVHOXBiblFnSmlBd2VETkdJSHdnTUhnNE1GeHVJQ0FnSUNBZ0tWeHVJQ0FnSUgwZ1pXeHpaU0I3WEc0Z0lDQWdJQ0IwYUhKdmR5QnVaWGNnUlhKeWIzSW9KMGx1ZG1Gc2FXUWdZMjlrWlNCd2IybHVkQ2NwWEc0Z0lDQWdmVnh1SUNCOVhHNWNiaUFnY21WMGRYSnVJR0o1ZEdWelhHNTlYRzVjYm1aMWJtTjBhVzl1SUdGelkybHBWRzlDZVhSbGN5QW9jM1J5S1NCN1hHNGdJSFpoY2lCaWVYUmxRWEp5WVhrZ1BTQmJYVnh1SUNCbWIzSWdLSFpoY2lCcElEMGdNRHNnYVNBOElITjBjaTVzWlc1bmRHZzdJR2tyS3lrZ2UxeHVJQ0FnSUM4dklFNXZaR1VuY3lCamIyUmxJSE5sWlcxeklIUnZJR0psSUdSdmFXNW5JSFJvYVhNZ1lXNWtJRzV2ZENBbUlEQjROMFl1TGx4dUlDQWdJR0o1ZEdWQmNuSmhlUzV3ZFhOb0tITjBjaTVqYUdGeVEyOWtaVUYwS0drcElDWWdNSGhHUmlsY2JpQWdmVnh1SUNCeVpYUjFjbTRnWW5sMFpVRnljbUY1WEc1OVhHNWNibVoxYm1OMGFXOXVJSFYwWmpFMmJHVlViMEo1ZEdWeklDaHpkSElzSUhWdWFYUnpLU0I3WEc0Z0lIWmhjaUJqTENCb2FTd2diRzljYmlBZ2RtRnlJR0o1ZEdWQmNuSmhlU0E5SUZ0ZFhHNGdJR1p2Y2lBb2RtRnlJR2tnUFNBd095QnBJRHdnYzNSeUxteGxibWQwYURzZ2FTc3JLU0I3WEc0Z0lDQWdhV1lnS0NoMWJtbDBjeUF0UFNBeUtTQThJREFwSUdKeVpXRnJYRzVjYmlBZ0lDQmpJRDBnYzNSeUxtTm9ZWEpEYjJSbFFYUW9hU2xjYmlBZ0lDQm9hU0E5SUdNZ1BqNGdPRnh1SUNBZ0lHeHZJRDBnWXlBbElESTFObHh1SUNBZ0lHSjVkR1ZCY25KaGVTNXdkWE5vS0d4dktWeHVJQ0FnSUdKNWRHVkJjbkpoZVM1d2RYTm9LR2hwS1Z4dUlDQjlYRzVjYmlBZ2NtVjBkWEp1SUdKNWRHVkJjbkpoZVZ4dWZWeHVYRzVtZFc1amRHbHZiaUJpWVhObE5qUlViMEo1ZEdWeklDaHpkSElwSUh0Y2JpQWdjbVYwZFhKdUlHSmhjMlUyTkM1MGIwSjVkR1ZCY25KaGVTaGlZWE5sTmpSamJHVmhiaWh6ZEhJcEtWeHVmVnh1WEc1bWRXNWpkR2x2YmlCaWJHbDBRblZtWm1WeUlDaHpjbU1zSUdSemRDd2diMlptYzJWMExDQnNaVzVuZEdncElIdGNiaUFnWm05eUlDaDJZWElnYVNBOUlEQTdJR2tnUENCc1pXNW5kR2c3SUdrckt5a2dlMXh1SUNBZ0lHbG1JQ2dvYVNBcklHOW1abk5sZENBK1BTQmtjM1F1YkdWdVozUm9LU0I4ZkNBb2FTQStQU0J6Y21NdWJHVnVaM1JvS1NrZ1luSmxZV3RjYmlBZ0lDQmtjM1JiYVNBcklHOW1abk5sZEYwZ1BTQnpjbU5iYVYxY2JpQWdmVnh1SUNCeVpYUjFjbTRnYVZ4dWZWeHVYRzVtZFc1amRHbHZiaUJrWldOdlpHVlZkR1k0UTJoaGNpQW9jM1J5S1NCN1hHNGdJSFJ5ZVNCN1hHNGdJQ0FnY21WMGRYSnVJR1JsWTI5a1pWVlNTVU52YlhCdmJtVnVkQ2h6ZEhJcFhHNGdJSDBnWTJGMFkyZ2dLR1Z5Y2lrZ2UxeHVJQ0FnSUhKbGRIVnliaUJUZEhKcGJtY3Vabkp2YlVOb1lYSkRiMlJsS0RCNFJrWkdSQ2tnTHk4Z1ZWUkdJRGdnYVc1MllXeHBaQ0JqYUdGeVhHNGdJSDFjYm4xY2JpSmRmUT09IiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKCdfcHJvY2VzcycpLHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWwgOiB0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9iYXNlNjQtanMvbGliL2I2NC5qc1wiLFwiLy4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9iYXNlNjQtanMvbGliXCIpXG4vLyMgc291cmNlTWFwcGluZ1VSTD1kYXRhOmFwcGxpY2F0aW9uL2pzb247Y2hhcnNldDp1dGYtODtiYXNlNjQsZXlKMlpYSnphVzl1SWpvekxDSnpiM1Z5WTJWeklqcGJJaTR1TDI1dlpHVmZiVzlrZFd4bGN5OW5kV3h3TFdOdlptWmxaV2xtZVM5dWIyUmxYMjF2WkhWc1pYTXZZbkp2ZDNObGNtbG1lUzl1YjJSbFgyMXZaSFZzWlhNdlluVm1abVZ5TDI1dlpHVmZiVzlrZFd4bGN5OWlZWE5sTmpRdGFuTXZiR2xpTDJJMk5DNXFjeUpkTENKdVlXMWxjeUk2VzEwc0ltMWhjSEJwYm1keklqb2lPMEZCUVVFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVNJc0ltWnBiR1VpT2lKblpXNWxjbUYwWldRdWFuTWlMQ0p6YjNWeVkyVlNiMjkwSWpvaUlpd2ljMjkxY21ObGMwTnZiblJsYm5RaU9sc2lkbUZ5SUd4dmIydDFjQ0E5SUNkQlFrTkVSVVpIU0VsS1MweE5UazlRVVZKVFZGVldWMWhaV21GaVkyUmxabWRvYVdwcmJHMXViM0J4Y25OMGRYWjNlSGw2TURFeU16UTFOamM0T1Nzdkp6dGNibHh1T3lobWRXNWpkR2x2YmlBb1pYaHdiM0owY3lrZ2UxeHVYSFFuZFhObElITjBjbWxqZENjN1hHNWNiaUFnZG1GeUlFRnljaUE5SUNoMGVYQmxiMllnVldsdWREaEJjbkpoZVNBaFBUMGdKM1Z1WkdWbWFXNWxaQ2NwWEc0Z0lDQWdQeUJWYVc1ME9FRnljbUY1WEc0Z0lDQWdPaUJCY25KaGVWeHVYRzVjZEhaaGNpQlFURlZUSUNBZ1BTQW5LeWN1WTJoaGNrTnZaR1ZCZENnd0tWeHVYSFIyWVhJZ1UweEJVMGdnSUQwZ0p5OG5MbU5vWVhKRGIyUmxRWFFvTUNsY2JseDBkbUZ5SUU1VlRVSkZVaUE5SUNjd0p5NWphR0Z5UTI5a1pVRjBLREFwWEc1Y2RIWmhjaUJNVDFkRlVpQWdQU0FuWVNjdVkyaGhja052WkdWQmRDZ3dLVnh1WEhSMllYSWdWVkJRUlZJZ0lEMGdKMEVuTG1Ob1lYSkRiMlJsUVhRb01DbGNibHgwZG1GeUlGQk1WVk5mVlZKTVgxTkJSa1VnUFNBbkxTY3VZMmhoY2tOdlpHVkJkQ2d3S1Z4dVhIUjJZWElnVTB4QlUwaGZWVkpNWDFOQlJrVWdQU0FuWHljdVkyaGhja052WkdWQmRDZ3dLVnh1WEc1Y2RHWjFibU4wYVc5dUlHUmxZMjlrWlNBb1pXeDBLU0I3WEc1Y2RGeDBkbUZ5SUdOdlpHVWdQU0JsYkhRdVkyaGhja052WkdWQmRDZ3dLVnh1WEhSY2RHbG1JQ2hqYjJSbElEMDlQU0JRVEZWVElIeDhYRzVjZEZ4MElDQWdJR052WkdVZ1BUMDlJRkJNVlZOZlZWSk1YMU5CUmtVcFhHNWNkRngwWEhSeVpYUjFjbTRnTmpJZ0x5OGdKeXNuWEc1Y2RGeDBhV1lnS0dOdlpHVWdQVDA5SUZOTVFWTklJSHg4WEc1Y2RGeDBJQ0FnSUdOdlpHVWdQVDA5SUZOTVFWTklYMVZTVEY5VFFVWkZLVnh1WEhSY2RGeDBjbVYwZFhKdUlEWXpJQzh2SUNjdkoxeHVYSFJjZEdsbUlDaGpiMlJsSUR3Z1RsVk5Ra1ZTS1Z4dVhIUmNkRngwY21WMGRYSnVJQzB4SUM4dmJtOGdiV0YwWTJoY2JseDBYSFJwWmlBb1kyOWtaU0E4SUU1VlRVSkZVaUFySURFd0tWeHVYSFJjZEZ4MGNtVjBkWEp1SUdOdlpHVWdMU0JPVlUxQ1JWSWdLeUF5TmlBcklESTJYRzVjZEZ4MGFXWWdLR052WkdVZ1BDQlZVRkJGVWlBcklESTJLVnh1WEhSY2RGeDBjbVYwZFhKdUlHTnZaR1VnTFNCVlVGQkZVbHh1WEhSY2RHbG1JQ2hqYjJSbElEd2dURTlYUlZJZ0t5QXlOaWxjYmx4MFhIUmNkSEpsZEhWeWJpQmpiMlJsSUMwZ1RFOVhSVklnS3lBeU5seHVYSFI5WEc1Y2JseDBablZ1WTNScGIyNGdZalkwVkc5Q2VYUmxRWEp5WVhrZ0tHSTJOQ2tnZTF4dVhIUmNkSFpoY2lCcExDQnFMQ0JzTENCMGJYQXNJSEJzWVdObFNHOXNaR1Z5Y3l3Z1lYSnlYRzVjYmx4MFhIUnBaaUFvWWpZMExteGxibWQwYUNBbElEUWdQaUF3S1NCN1hHNWNkRngwWEhSMGFISnZkeUJ1WlhjZ1JYSnliM0lvSjBsdWRtRnNhV1FnYzNSeWFXNW5MaUJNWlc1bmRHZ2diWFZ6ZENCaVpTQmhJRzExYkhScGNHeGxJRzltSURRbktWeHVYSFJjZEgxY2JseHVYSFJjZEM4dklIUm9aU0J1ZFcxaVpYSWdiMllnWlhGMVlXd2djMmxuYm5NZ0tIQnNZV05sSUdodmJHUmxjbk1wWEc1Y2RGeDBMeThnYVdZZ2RHaGxjbVVnWVhKbElIUjNieUJ3YkdGalpXaHZiR1JsY25Nc0lIUm9ZVzRnZEdobElIUjNieUJqYUdGeVlXTjBaWEp6SUdKbFptOXlaU0JwZEZ4dVhIUmNkQzh2SUhKbGNISmxjMlZ1ZENCdmJtVWdZbmwwWlZ4dVhIUmNkQzh2SUdsbUlIUm9aWEpsSUdseklHOXViSGtnYjI1bExDQjBhR1Z1SUhSb1pTQjBhSEpsWlNCamFHRnlZV04wWlhKeklHSmxabTl5WlNCcGRDQnlaWEJ5WlhObGJuUWdNaUJpZVhSbGMxeHVYSFJjZEM4dklIUm9hWE1nYVhNZ2FuVnpkQ0JoSUdOb1pXRndJR2hoWTJzZ2RHOGdibTkwSUdSdklHbHVaR1Y0VDJZZ2RIZHBZMlZjYmx4MFhIUjJZWElnYkdWdUlEMGdZalkwTG14bGJtZDBhRnh1WEhSY2RIQnNZV05sU0c5c1pHVnljeUE5SUNjOUp5QTlQVDBnWWpZMExtTm9ZWEpCZENoc1pXNGdMU0F5S1NBL0lESWdPaUFuUFNjZ1BUMDlJR0kyTkM1amFHRnlRWFFvYkdWdUlDMGdNU2tnUHlBeElEb2dNRnh1WEc1Y2RGeDBMeThnWW1GelpUWTBJR2x6SURRdk15QXJJSFZ3SUhSdklIUjNieUJqYUdGeVlXTjBaWEp6SUc5bUlIUm9aU0J2Y21sbmFXNWhiQ0JrWVhSaFhHNWNkRngwWVhKeUlEMGdibVYzSUVGeWNpaGlOalF1YkdWdVozUm9JQ29nTXlBdklEUWdMU0J3YkdGalpVaHZiR1JsY25NcFhHNWNibHgwWEhRdkx5QnBaaUIwYUdWeVpTQmhjbVVnY0d4aFkyVm9iMnhrWlhKekxDQnZibXg1SUdkbGRDQjFjQ0IwYnlCMGFHVWdiR0Z6ZENCamIyMXdiR1YwWlNBMElHTm9ZWEp6WEc1Y2RGeDBiQ0E5SUhCc1lXTmxTRzlzWkdWeWN5QStJREFnUHlCaU5qUXViR1Z1WjNSb0lDMGdOQ0E2SUdJMk5DNXNaVzVuZEdoY2JseHVYSFJjZEhaaGNpQk1JRDBnTUZ4dVhHNWNkRngwWm5WdVkzUnBiMjRnY0hWemFDQW9kaWtnZTF4dVhIUmNkRngwWVhKeVcwd3JLMTBnUFNCMlhHNWNkRngwZlZ4dVhHNWNkRngwWm05eUlDaHBJRDBnTUN3Z2FpQTlJREE3SUdrZ1BDQnNPeUJwSUNzOUlEUXNJR29nS3owZ015a2dlMXh1WEhSY2RGeDBkRzF3SUQwZ0tHUmxZMjlrWlNoaU5qUXVZMmhoY2tGMEtHa3BLU0E4UENBeE9Da2dmQ0FvWkdWamIyUmxLR0kyTkM1amFHRnlRWFFvYVNBcklERXBLU0E4UENBeE1pa2dmQ0FvWkdWamIyUmxLR0kyTkM1amFHRnlRWFFvYVNBcklESXBLU0E4UENBMktTQjhJR1JsWTI5a1pTaGlOalF1WTJoaGNrRjBLR2tnS3lBektTbGNibHgwWEhSY2RIQjFjMmdvS0hSdGNDQW1JREI0UmtZd01EQXdLU0ErUGlBeE5pbGNibHgwWEhSY2RIQjFjMmdvS0hSdGNDQW1JREI0UmtZd01Da2dQajRnT0NsY2JseDBYSFJjZEhCMWMyZ29kRzF3SUNZZ01IaEdSaWxjYmx4MFhIUjlYRzVjYmx4MFhIUnBaaUFvY0d4aFkyVkliMnhrWlhKeklEMDlQU0F5S1NCN1hHNWNkRngwWEhSMGJYQWdQU0FvWkdWamIyUmxLR0kyTkM1amFHRnlRWFFvYVNrcElEdzhJRElwSUh3Z0tHUmxZMjlrWlNoaU5qUXVZMmhoY2tGMEtHa2dLeUF4S1NrZ1BqNGdOQ2xjYmx4MFhIUmNkSEIxYzJnb2RHMXdJQ1lnTUhoR1JpbGNibHgwWEhSOUlHVnNjMlVnYVdZZ0tIQnNZV05sU0c5c1pHVnljeUE5UFQwZ01Ta2dlMXh1WEhSY2RGeDBkRzF3SUQwZ0tHUmxZMjlrWlNoaU5qUXVZMmhoY2tGMEtHa3BLU0E4UENBeE1Da2dmQ0FvWkdWamIyUmxLR0kyTkM1amFHRnlRWFFvYVNBcklERXBLU0E4UENBMEtTQjhJQ2hrWldOdlpHVW9ZalkwTG1Ob1lYSkJkQ2hwSUNzZ01pa3BJRDQrSURJcFhHNWNkRngwWEhSd2RYTm9LQ2gwYlhBZ1BqNGdPQ2tnSmlBd2VFWkdLVnh1WEhSY2RGeDBjSFZ6YUNoMGJYQWdKaUF3ZUVaR0tWeHVYSFJjZEgxY2JseHVYSFJjZEhKbGRIVnliaUJoY25KY2JseDBmVnh1WEc1Y2RHWjFibU4wYVc5dUlIVnBiblE0Vkc5Q1lYTmxOalFnS0hWcGJuUTRLU0I3WEc1Y2RGeDBkbUZ5SUdrc1hHNWNkRngwWEhSbGVIUnlZVUo1ZEdWeklEMGdkV2x1ZERndWJHVnVaM1JvSUNVZ015d2dMeThnYVdZZ2QyVWdhR0YyWlNBeElHSjVkR1VnYkdWbWRDd2djR0ZrSURJZ1lubDBaWE5jYmx4MFhIUmNkRzkxZEhCMWRDQTlJRndpWENJc1hHNWNkRngwWEhSMFpXMXdMQ0JzWlc1bmRHaGNibHh1WEhSY2RHWjFibU4wYVc5dUlHVnVZMjlrWlNBb2JuVnRLU0I3WEc1Y2RGeDBYSFJ5WlhSMWNtNGdiRzl2YTNWd0xtTm9ZWEpCZENodWRXMHBYRzVjZEZ4MGZWeHVYRzVjZEZ4MFpuVnVZM1JwYjI0Z2RISnBjR3hsZEZSdlFtRnpaVFkwSUNodWRXMHBJSHRjYmx4MFhIUmNkSEpsZEhWeWJpQmxibU52WkdVb2JuVnRJRDQrSURFNElDWWdNSGd6UmlrZ0t5QmxibU52WkdVb2JuVnRJRDQrSURFeUlDWWdNSGd6UmlrZ0t5QmxibU52WkdVb2JuVnRJRDQrSURZZ0ppQXdlRE5HS1NBcklHVnVZMjlrWlNodWRXMGdKaUF3ZUROR0tWeHVYSFJjZEgxY2JseHVYSFJjZEM4dklHZHZJSFJvY205MVoyZ2dkR2hsSUdGeWNtRjVJR1YyWlhKNUlIUm9jbVZsSUdKNWRHVnpMQ0IzWlNkc2JDQmtaV0ZzSUhkcGRHZ2dkSEpoYVd4cGJtY2djM1IxWm1ZZ2JHRjBaWEpjYmx4MFhIUm1iM0lnS0drZ1BTQXdMQ0JzWlc1bmRHZ2dQU0IxYVc1ME9DNXNaVzVuZEdnZ0xTQmxlSFJ5WVVKNWRHVnpPeUJwSUR3Z2JHVnVaM1JvT3lCcElDczlJRE1wSUh0Y2JseDBYSFJjZEhSbGJYQWdQU0FvZFdsdWREaGJhVjBnUER3Z01UWXBJQ3NnS0hWcGJuUTRXMmtnS3lBeFhTQThQQ0E0S1NBcklDaDFhVzUwT0Z0cElDc2dNbDBwWEc1Y2RGeDBYSFJ2ZFhSd2RYUWdLejBnZEhKcGNHeGxkRlJ2UW1GelpUWTBLSFJsYlhBcFhHNWNkRngwZlZ4dVhHNWNkRngwTHk4Z2NHRmtJSFJvWlNCbGJtUWdkMmwwYUNCNlpYSnZjeXdnWW5WMElHMWhhMlVnYzNWeVpTQjBieUJ1YjNRZ1ptOXlaMlYwSUhSb1pTQmxlSFJ5WVNCaWVYUmxjMXh1WEhSY2RITjNhWFJqYUNBb1pYaDBjbUZDZVhSbGN5a2dlMXh1WEhSY2RGeDBZMkZ6WlNBeE9seHVYSFJjZEZ4MFhIUjBaVzF3SUQwZ2RXbHVkRGhiZFdsdWREZ3ViR1Z1WjNSb0lDMGdNVjFjYmx4MFhIUmNkRngwYjNWMGNIVjBJQ3M5SUdWdVkyOWtaU2gwWlcxd0lENCtJRElwWEc1Y2RGeDBYSFJjZEc5MWRIQjFkQ0FyUFNCbGJtTnZaR1VvS0hSbGJYQWdQRHdnTkNrZ0ppQXdlRE5HS1Z4dVhIUmNkRngwWEhSdmRYUndkWFFnS3owZ0p6MDlKMXh1WEhSY2RGeDBYSFJpY21WaGExeHVYSFJjZEZ4MFkyRnpaU0F5T2x4dVhIUmNkRngwWEhSMFpXMXdJRDBnS0hWcGJuUTRXM1ZwYm5RNExteGxibWQwYUNBdElESmRJRHc4SURncElDc2dLSFZwYm5RNFczVnBiblE0TG14bGJtZDBhQ0F0SURGZEtWeHVYSFJjZEZ4MFhIUnZkWFJ3ZFhRZ0t6MGdaVzVqYjJSbEtIUmxiWEFnUGo0Z01UQXBYRzVjZEZ4MFhIUmNkRzkxZEhCMWRDQXJQU0JsYm1OdlpHVW9LSFJsYlhBZ1BqNGdOQ2tnSmlBd2VETkdLVnh1WEhSY2RGeDBYSFJ2ZFhSd2RYUWdLejBnWlc1amIyUmxLQ2gwWlcxd0lEdzhJRElwSUNZZ01IZ3pSaWxjYmx4MFhIUmNkRngwYjNWMGNIVjBJQ3M5SUNjOUoxeHVYSFJjZEZ4MFhIUmljbVZoYTF4dVhIUmNkSDFjYmx4dVhIUmNkSEpsZEhWeWJpQnZkWFJ3ZFhSY2JseDBmVnh1WEc1Y2RHVjRjRzl5ZEhNdWRHOUNlWFJsUVhKeVlYa2dQU0JpTmpSVWIwSjVkR1ZCY25KaGVWeHVYSFJsZUhCdmNuUnpMbVp5YjIxQ2VYUmxRWEp5WVhrZ1BTQjFhVzUwT0ZSdlFtRnpaVFkwWEc1OUtIUjVjR1Z2WmlCbGVIQnZjblJ6SUQwOVBTQW5kVzVrWldacGJtVmtKeUEvSUNoMGFHbHpMbUpoYzJVMk5HcHpJRDBnZTMwcElEb2daWGh3YjNKMGN5a3BYRzRpWFgwPSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbmV4cG9ydHMucmVhZCA9IGZ1bmN0aW9uIChidWZmZXIsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtXG4gIHZhciBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxXG4gIHZhciBlTWF4ID0gKDEgPDwgZUxlbikgLSAxXG4gIHZhciBlQmlhcyA9IGVNYXggPj4gMVxuICB2YXIgbkJpdHMgPSAtN1xuICB2YXIgaSA9IGlzTEUgPyAobkJ5dGVzIC0gMSkgOiAwXG4gIHZhciBkID0gaXNMRSA/IC0xIDogMVxuICB2YXIgcyA9IGJ1ZmZlcltvZmZzZXQgKyBpXVxuXG4gIGkgKz0gZFxuXG4gIGUgPSBzICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIHMgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IGVMZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgZSA9IGUgKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBtID0gZSAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBlID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBtTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IG0gPSBtICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgaWYgKGUgPT09IDApIHtcbiAgICBlID0gMSAtIGVCaWFzXG4gIH0gZWxzZSBpZiAoZSA9PT0gZU1heCkge1xuICAgIHJldHVybiBtID8gTmFOIDogKChzID8gLTEgOiAxKSAqIEluZmluaXR5KVxuICB9IGVsc2Uge1xuICAgIG0gPSBtICsgTWF0aC5wb3coMiwgbUxlbilcbiAgICBlID0gZSAtIGVCaWFzXG4gIH1cbiAgcmV0dXJuIChzID8gLTEgOiAxKSAqIG0gKiBNYXRoLnBvdygyLCBlIC0gbUxlbilcbn1cblxuZXhwb3J0cy53cml0ZSA9IGZ1bmN0aW9uIChidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSwgY1xuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIHJ0ID0gKG1MZW4gPT09IDIzID8gTWF0aC5wb3coMiwgLTI0KSAtIE1hdGgucG93KDIsIC03NykgOiAwKVxuICB2YXIgaSA9IGlzTEUgPyAwIDogKG5CeXRlcyAtIDEpXG4gIHZhciBkID0gaXNMRSA/IDEgOiAtMVxuICB2YXIgcyA9IHZhbHVlIDwgMCB8fCAodmFsdWUgPT09IDAgJiYgMSAvIHZhbHVlIDwgMCkgPyAxIDogMFxuXG4gIHZhbHVlID0gTWF0aC5hYnModmFsdWUpXG5cbiAgaWYgKGlzTmFOKHZhbHVlKSB8fCB2YWx1ZSA9PT0gSW5maW5pdHkpIHtcbiAgICBtID0gaXNOYU4odmFsdWUpID8gMSA6IDBcbiAgICBlID0gZU1heFxuICB9IGVsc2Uge1xuICAgIGUgPSBNYXRoLmZsb29yKE1hdGgubG9nKHZhbHVlKSAvIE1hdGguTE4yKVxuICAgIGlmICh2YWx1ZSAqIChjID0gTWF0aC5wb3coMiwgLWUpKSA8IDEpIHtcbiAgICAgIGUtLVxuICAgICAgYyAqPSAyXG4gICAgfVxuICAgIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgdmFsdWUgKz0gcnQgLyBjXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbHVlICs9IHJ0ICogTWF0aC5wb3coMiwgMSAtIGVCaWFzKVxuICAgIH1cbiAgICBpZiAodmFsdWUgKiBjID49IDIpIHtcbiAgICAgIGUrK1xuICAgICAgYyAvPSAyXG4gICAgfVxuXG4gICAgaWYgKGUgKyBlQmlhcyA+PSBlTWF4KSB7XG4gICAgICBtID0gMFxuICAgICAgZSA9IGVNYXhcbiAgICB9IGVsc2UgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICBtID0gKHZhbHVlICogYyAtIDEpICogTWF0aC5wb3coMiwgbUxlbilcbiAgICAgIGUgPSBlICsgZUJpYXNcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IHZhbHVlICogTWF0aC5wb3coMiwgZUJpYXMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gMFxuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBtTGVuID49IDg7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IG0gJiAweGZmLCBpICs9IGQsIG0gLz0gMjU2LCBtTGVuIC09IDgpIHt9XG5cbiAgZSA9IChlIDw8IG1MZW4pIHwgbVxuICBlTGVuICs9IG1MZW5cbiAgZm9yICg7IGVMZW4gPiAwOyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBlICYgMHhmZiwgaSArPSBkLCBlIC89IDI1NiwgZUxlbiAtPSA4KSB7fVxuXG4gIGJ1ZmZlcltvZmZzZXQgKyBpIC0gZF0gfD0gcyAqIDEyOFxufVxuXG59KS5jYWxsKHRoaXMscmVxdWlyZSgnX3Byb2Nlc3MnKSx0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiID8gZ2xvYmFsIDogdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9ub2RlX21vZHVsZXMvZ3VscC1jb2ZmZWVpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaWVlZTc1NC9pbmRleC5qc1wiLFwiLy4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0XCIpXG4vLyMgc291cmNlTWFwcGluZ1VSTD1kYXRhOmFwcGxpY2F0aW9uL2pzb247Y2hhcnNldDp1dGYtODtiYXNlNjQsZXlKMlpYSnphVzl1SWpvekxDSnpiM1Z5WTJWeklqcGJJaTR1TDI1dlpHVmZiVzlrZFd4bGN5OW5kV3h3TFdOdlptWmxaV2xtZVM5dWIyUmxYMjF2WkhWc1pYTXZZbkp2ZDNObGNtbG1lUzl1YjJSbFgyMXZaSFZzWlhNdlluVm1abVZ5TDI1dlpHVmZiVzlrZFd4bGN5OXBaV1ZsTnpVMEwybHVaR1Y0TG1weklsMHNJbTVoYldWeklqcGJYU3dpYldGd2NHbHVaM01pT2lJN1FVRkJRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFTSXNJbVpwYkdVaU9pSm5aVzVsY21GMFpXUXVhbk1pTENKemIzVnlZMlZTYjI5MElqb2lJaXdpYzI5MWNtTmxjME52Ym5SbGJuUWlPbHNpWlhod2IzSjBjeTV5WldGa0lEMGdablZ1WTNScGIyNGdLR0oxWm1abGNpd2diMlptYzJWMExDQnBjMHhGTENCdFRHVnVMQ0J1UW5sMFpYTXBJSHRjYmlBZ2RtRnlJR1VzSUcxY2JpQWdkbUZ5SUdWTVpXNGdQU0J1UW5sMFpYTWdLaUE0SUMwZ2JVeGxiaUF0SURGY2JpQWdkbUZ5SUdWTllYZ2dQU0FvTVNBOFBDQmxUR1Z1S1NBdElERmNiaUFnZG1GeUlHVkNhV0Z6SUQwZ1pVMWhlQ0ErUGlBeFhHNGdJSFpoY2lCdVFtbDBjeUE5SUMwM1hHNGdJSFpoY2lCcElEMGdhWE5NUlNBL0lDaHVRbmwwWlhNZ0xTQXhLU0E2SURCY2JpQWdkbUZ5SUdRZ1BTQnBjMHhGSUQ4Z0xURWdPaUF4WEc0Z0lIWmhjaUJ6SUQwZ1luVm1abVZ5VzI5bVpuTmxkQ0FySUdsZFhHNWNiaUFnYVNBclBTQmtYRzVjYmlBZ1pTQTlJSE1nSmlBb0tERWdQRHdnS0MxdVFtbDBjeWtwSUMwZ01TbGNiaUFnY3lBK1BqMGdLQzF1UW1sMGN5bGNiaUFnYmtKcGRITWdLejBnWlV4bGJseHVJQ0JtYjNJZ0tEc2dia0pwZEhNZ1BpQXdPeUJsSUQwZ1pTQXFJREkxTmlBcklHSjFabVpsY2x0dlptWnpaWFFnS3lCcFhTd2dhU0FyUFNCa0xDQnVRbWwwY3lBdFBTQTRLU0I3ZlZ4dVhHNGdJRzBnUFNCbElDWWdLQ2d4SUR3OElDZ3Ria0pwZEhNcEtTQXRJREVwWEc0Z0lHVWdQajQ5SUNndGJrSnBkSE1wWEc0Z0lHNUNhWFJ6SUNzOUlHMU1aVzVjYmlBZ1ptOXlJQ2c3SUc1Q2FYUnpJRDRnTURzZ2JTQTlJRzBnS2lBeU5UWWdLeUJpZFdabVpYSmJiMlptYzJWMElDc2dhVjBzSUdrZ0t6MGdaQ3dnYmtKcGRITWdMVDBnT0NrZ2UzMWNibHh1SUNCcFppQW9aU0E5UFQwZ01Da2dlMXh1SUNBZ0lHVWdQU0F4SUMwZ1pVSnBZWE5jYmlBZ2ZTQmxiSE5sSUdsbUlDaGxJRDA5UFNCbFRXRjRLU0I3WEc0Z0lDQWdjbVYwZFhKdUlHMGdQeUJPWVU0Z09pQW9LSE1nUHlBdE1TQTZJREVwSUNvZ1NXNW1hVzVwZEhrcFhHNGdJSDBnWld4elpTQjdYRzRnSUNBZ2JTQTlJRzBnS3lCTllYUm9MbkJ2ZHlneUxDQnRUR1Z1S1Z4dUlDQWdJR1VnUFNCbElDMGdaVUpwWVhOY2JpQWdmVnh1SUNCeVpYUjFjbTRnS0hNZ1B5QXRNU0E2SURFcElDb2diU0FxSUUxaGRHZ3VjRzkzS0RJc0lHVWdMU0J0VEdWdUtWeHVmVnh1WEc1bGVIQnZjblJ6TG5keWFYUmxJRDBnWm5WdVkzUnBiMjRnS0dKMVptWmxjaXdnZG1Gc2RXVXNJRzltWm5ObGRDd2dhWE5NUlN3Z2JVeGxiaXdnYmtKNWRHVnpLU0I3WEc0Z0lIWmhjaUJsTENCdExDQmpYRzRnSUhaaGNpQmxUR1Z1SUQwZ2JrSjVkR1Z6SUNvZ09DQXRJRzFNWlc0Z0xTQXhYRzRnSUhaaGNpQmxUV0Y0SUQwZ0tERWdQRHdnWlV4bGJpa2dMU0F4WEc0Z0lIWmhjaUJsUW1saGN5QTlJR1ZOWVhnZ1BqNGdNVnh1SUNCMllYSWdjblFnUFNBb2JVeGxiaUE5UFQwZ01qTWdQeUJOWVhSb0xuQnZkeWd5TENBdE1qUXBJQzBnVFdGMGFDNXdiM2NvTWl3Z0xUYzNLU0E2SURBcFhHNGdJSFpoY2lCcElEMGdhWE5NUlNBL0lEQWdPaUFvYmtKNWRHVnpJQzBnTVNsY2JpQWdkbUZ5SUdRZ1BTQnBjMHhGSUQ4Z01TQTZJQzB4WEc0Z0lIWmhjaUJ6SUQwZ2RtRnNkV1VnUENBd0lIeDhJQ2gyWVd4MVpTQTlQVDBnTUNBbUppQXhJQzhnZG1Gc2RXVWdQQ0F3S1NBL0lERWdPaUF3WEc1Y2JpQWdkbUZzZFdVZ1BTQk5ZWFJvTG1GaWN5aDJZV3gxWlNsY2JseHVJQ0JwWmlBb2FYTk9ZVTRvZG1Gc2RXVXBJSHg4SUhaaGJIVmxJRDA5UFNCSmJtWnBibWwwZVNrZ2UxeHVJQ0FnSUcwZ1BTQnBjMDVoVGloMllXeDFaU2tnUHlBeElEb2dNRnh1SUNBZ0lHVWdQU0JsVFdGNFhHNGdJSDBnWld4elpTQjdYRzRnSUNBZ1pTQTlJRTFoZEdndVpteHZiM0lvVFdGMGFDNXNiMmNvZG1Gc2RXVXBJQzhnVFdGMGFDNU1UaklwWEc0Z0lDQWdhV1lnS0haaGJIVmxJQ29nS0dNZ1BTQk5ZWFJvTG5CdmR5Z3lMQ0F0WlNrcElEd2dNU2tnZTF4dUlDQWdJQ0FnWlMwdFhHNGdJQ0FnSUNCaklDbzlJREpjYmlBZ0lDQjlYRzRnSUNBZ2FXWWdLR1VnS3lCbFFtbGhjeUErUFNBeEtTQjdYRzRnSUNBZ0lDQjJZV3gxWlNBclBTQnlkQ0F2SUdOY2JpQWdJQ0I5SUdWc2MyVWdlMXh1SUNBZ0lDQWdkbUZzZFdVZ0t6MGdjblFnS2lCTllYUm9MbkJ2ZHlneUxDQXhJQzBnWlVKcFlYTXBYRzRnSUNBZ2ZWeHVJQ0FnSUdsbUlDaDJZV3gxWlNBcUlHTWdQajBnTWlrZ2UxeHVJQ0FnSUNBZ1pTc3JYRzRnSUNBZ0lDQmpJQzg5SURKY2JpQWdJQ0I5WEc1Y2JpQWdJQ0JwWmlBb1pTQXJJR1ZDYVdGeklENDlJR1ZOWVhncElIdGNiaUFnSUNBZ0lHMGdQU0F3WEc0Z0lDQWdJQ0JsSUQwZ1pVMWhlRnh1SUNBZ0lIMGdaV3h6WlNCcFppQW9aU0FySUdWQ2FXRnpJRDQ5SURFcElIdGNiaUFnSUNBZ0lHMGdQU0FvZG1Gc2RXVWdLaUJqSUMwZ01Ta2dLaUJOWVhSb0xuQnZkeWd5TENCdFRHVnVLVnh1SUNBZ0lDQWdaU0E5SUdVZ0t5QmxRbWxoYzF4dUlDQWdJSDBnWld4elpTQjdYRzRnSUNBZ0lDQnRJRDBnZG1Gc2RXVWdLaUJOWVhSb0xuQnZkeWd5TENCbFFtbGhjeUF0SURFcElDb2dUV0YwYUM1d2IzY29NaXdnYlV4bGJpbGNiaUFnSUNBZ0lHVWdQU0F3WEc0Z0lDQWdmVnh1SUNCOVhHNWNiaUFnWm05eUlDZzdJRzFNWlc0Z1BqMGdPRHNnWW5WbVptVnlXMjltWm5ObGRDQXJJR2xkSUQwZ2JTQW1JREI0Wm1Zc0lHa2dLejBnWkN3Z2JTQXZQU0F5TlRZc0lHMU1aVzRnTFQwZ09Da2dlMzFjYmx4dUlDQmxJRDBnS0dVZ1BEd2diVXhsYmlrZ2ZDQnRYRzRnSUdWTVpXNGdLejBnYlV4bGJseHVJQ0JtYjNJZ0tEc2daVXhsYmlBK0lEQTdJR0oxWm1abGNsdHZabVp6WlhRZ0t5QnBYU0E5SUdVZ0ppQXdlR1ptTENCcElDczlJR1FzSUdVZ0x6MGdNalUyTENCbFRHVnVJQzA5SURncElIdDlYRzVjYmlBZ1luVm1abVZ5VzI5bVpuTmxkQ0FySUdrZ0xTQmtYU0I4UFNCeklDb2dNVEk0WEc1OVhHNGlYWDA9IiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xuXG4vKipcbiAqIGlzQXJyYXlcbiAqL1xuXG52YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXk7XG5cbi8qKlxuICogdG9TdHJpbmdcbiAqL1xuXG52YXIgc3RyID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcblxuLyoqXG4gKiBXaGV0aGVyIG9yIG5vdCB0aGUgZ2l2ZW4gYHZhbGBcbiAqIGlzIGFuIGFycmF5LlxuICpcbiAqIGV4YW1wbGU6XG4gKlxuICogICAgICAgIGlzQXJyYXkoW10pO1xuICogICAgICAgIC8vID4gdHJ1ZVxuICogICAgICAgIGlzQXJyYXkoYXJndW1lbnRzKTtcbiAqICAgICAgICAvLyA+IGZhbHNlXG4gKiAgICAgICAgaXNBcnJheSgnJyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICpcbiAqIEBwYXJhbSB7bWl4ZWR9IHZhbFxuICogQHJldHVybiB7Ym9vbH1cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGlzQXJyYXkgfHwgZnVuY3Rpb24gKHZhbCkge1xuICByZXR1cm4gISEgdmFsICYmICdbb2JqZWN0IEFycmF5XScgPT0gc3RyLmNhbGwodmFsKTtcbn07XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKCdfcHJvY2VzcycpLHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWwgOiB0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheS9pbmRleC5qc1wiLFwiLy4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheVwiKVxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9ZGF0YTphcHBsaWNhdGlvbi9qc29uO2NoYXJzZXQ6dXRmLTg7YmFzZTY0LGV5SjJaWEp6YVc5dUlqb3pMQ0p6YjNWeVkyVnpJanBiSWk0dUwyNXZaR1ZmYlc5a2RXeGxjeTluZFd4d0xXTnZabVpsWldsbWVTOXViMlJsWDIxdlpIVnNaWE12WW5KdmQzTmxjbWxtZVM5dWIyUmxYMjF2WkhWc1pYTXZZblZtWm1WeUwyNXZaR1ZmYlc5a2RXeGxjeTlwY3kxaGNuSmhlUzlwYm1SbGVDNXFjeUpkTENKdVlXMWxjeUk2VzEwc0ltMWhjSEJwYm1keklqb2lPMEZCUVVFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRWlMQ0ptYVd4bElqb2laMlZ1WlhKaGRHVmtMbXB6SWl3aWMyOTFjbU5sVW05dmRDSTZJaUlzSW5OdmRYSmpaWE5EYjI1MFpXNTBJanBiSWx4dUx5b3FYRzRnS2lCcGMwRnljbUY1WEc0Z0tpOWNibHh1ZG1GeUlHbHpRWEp5WVhrZ1BTQkJjbkpoZVM1cGMwRnljbUY1TzF4dVhHNHZLaXBjYmlBcUlIUnZVM1J5YVc1blhHNGdLaTljYmx4dWRtRnlJSE4wY2lBOUlFOWlhbVZqZEM1d2NtOTBiM1I1Y0dVdWRHOVRkSEpwYm1jN1hHNWNiaThxS2x4dUlDb2dWMmhsZEdobGNpQnZjaUJ1YjNRZ2RHaGxJR2RwZG1WdUlHQjJZV3hnWEc0Z0tpQnBjeUJoYmlCaGNuSmhlUzVjYmlBcVhHNGdLaUJsZUdGdGNHeGxPbHh1SUNwY2JpQXFJQ0FnSUNBZ0lDQnBjMEZ5Y21GNUtGdGRLVHRjYmlBcUlDQWdJQ0FnSUNBdkx5QStJSFJ5ZFdWY2JpQXFJQ0FnSUNBZ0lDQnBjMEZ5Y21GNUtHRnlaM1Z0Wlc1MGN5azdYRzRnS2lBZ0lDQWdJQ0FnTHk4Z1BpQm1ZV3h6WlZ4dUlDb2dJQ0FnSUNBZ0lHbHpRWEp5WVhrb0p5Y3BPMXh1SUNvZ0lDQWdJQ0FnSUM4dklENGdabUZzYzJWY2JpQXFYRzRnS2lCQWNHRnlZVzBnZTIxcGVHVmtmU0IyWVd4Y2JpQXFJRUJ5WlhSMWNtNGdlMkp2YjJ4OVhHNGdLaTljYmx4dWJXOWtkV3hsTG1WNGNHOXlkSE1nUFNCcGMwRnljbUY1SUh4OElHWjFibU4wYVc5dUlDaDJZV3dwSUh0Y2JpQWdjbVYwZFhKdUlDRWhJSFpoYkNBbUppQW5XMjlpYW1WamRDQkJjbkpoZVYwbklEMDlJSE4wY2k1allXeHNLSFpoYkNrN1hHNTlPMXh1SWwxOSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxuXG52YXIgcHJvY2VzcyA9IG1vZHVsZS5leHBvcnRzID0ge307XG52YXIgcXVldWUgPSBbXTtcbnZhciBkcmFpbmluZyA9IGZhbHNlO1xuXG5mdW5jdGlvbiBkcmFpblF1ZXVlKCkge1xuICAgIGlmIChkcmFpbmluZykge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGRyYWluaW5nID0gdHJ1ZTtcbiAgICB2YXIgY3VycmVudFF1ZXVlO1xuICAgIHZhciBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgd2hpbGUobGVuKSB7XG4gICAgICAgIGN1cnJlbnRRdWV1ZSA9IHF1ZXVlO1xuICAgICAgICBxdWV1ZSA9IFtdO1xuICAgICAgICB2YXIgaSA9IC0xO1xuICAgICAgICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgICAgICAgICBjdXJyZW50UXVldWVbaV0oKTtcbiAgICAgICAgfVxuICAgICAgICBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgfVxuICAgIGRyYWluaW5nID0gZmFsc2U7XG59XG5wcm9jZXNzLm5leHRUaWNrID0gZnVuY3Rpb24gKGZ1bikge1xuICAgIHF1ZXVlLnB1c2goZnVuKTtcbiAgICBpZiAoIWRyYWluaW5nKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZHJhaW5RdWV1ZSwgMCk7XG4gICAgfVxufTtcblxucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5wcm9jZXNzLnZlcnNpb24gPSAnJzsgLy8gZW1wdHkgc3RyaW5nIHRvIGF2b2lkIHJlZ2V4cCBpc3N1ZXNcbnByb2Nlc3MudmVyc2lvbnMgPSB7fTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbi8vIFRPRE8oc2h0eWxtYW4pXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKCdfcHJvY2VzcycpLHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWwgOiB0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL25vZGVfbW9kdWxlcy9ndWxwLWNvZmZlZWlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzXCIsXCIvLi4vbm9kZV9tb2R1bGVzL2d1bHAtY29mZmVlaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9wcm9jZXNzXCIpXG4vLyMgc291cmNlTWFwcGluZ1VSTD1kYXRhOmFwcGxpY2F0aW9uL2pzb247Y2hhcnNldDp1dGYtODtiYXNlNjQsZXlKMlpYSnphVzl1SWpvekxDSnpiM1Z5WTJWeklqcGJJaTR1TDI1dlpHVmZiVzlrZFd4bGN5OW5kV3h3TFdOdlptWmxaV2xtZVM5dWIyUmxYMjF2WkhWc1pYTXZZbkp2ZDNObGNtbG1lUzl1YjJSbFgyMXZaSFZzWlhNdmNISnZZMlZ6Y3k5aWNtOTNjMlZ5TG1weklsMHNJbTVoYldWeklqcGJYU3dpYldGd2NHbHVaM01pT2lJN1FVRkJRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CSWl3aVptbHNaU0k2SW1kbGJtVnlZWFJsWkM1cWN5SXNJbk52ZFhKalpWSnZiM1FpT2lJaUxDSnpiM1Z5WTJWelEyOXVkR1Z1ZENJNld5SXZMeUJ6YUdsdElHWnZjaUIxYzJsdVp5QndjbTlqWlhOeklHbHVJR0p5YjNkelpYSmNibHh1ZG1GeUlIQnliMk5sYzNNZ1BTQnRiMlIxYkdVdVpYaHdiM0owY3lBOUlIdDlPMXh1ZG1GeUlIRjFaWFZsSUQwZ1cxMDdYRzUyWVhJZ1pISmhhVzVwYm1jZ1BTQm1ZV3h6WlR0Y2JseHVablZ1WTNScGIyNGdaSEpoYVc1UmRXVjFaU2dwSUh0Y2JpQWdJQ0JwWmlBb1pISmhhVzVwYm1jcElIdGNiaUFnSUNBZ0lDQWdjbVYwZFhKdU8xeHVJQ0FnSUgxY2JpQWdJQ0JrY21GcGJtbHVaeUE5SUhSeWRXVTdYRzRnSUNBZ2RtRnlJR04xY25KbGJuUlJkV1YxWlR0Y2JpQWdJQ0IyWVhJZ2JHVnVJRDBnY1hWbGRXVXViR1Z1WjNSb08xeHVJQ0FnSUhkb2FXeGxLR3hsYmlrZ2UxeHVJQ0FnSUNBZ0lDQmpkWEp5Wlc1MFVYVmxkV1VnUFNCeGRXVjFaVHRjYmlBZ0lDQWdJQ0FnY1hWbGRXVWdQU0JiWFR0Y2JpQWdJQ0FnSUNBZ2RtRnlJR2tnUFNBdE1UdGNiaUFnSUNBZ0lDQWdkMmhwYkdVZ0tDc3JhU0E4SUd4bGJpa2dlMXh1SUNBZ0lDQWdJQ0FnSUNBZ1kzVnljbVZ1ZEZGMVpYVmxXMmxkS0NrN1hHNGdJQ0FnSUNBZ0lIMWNiaUFnSUNBZ0lDQWdiR1Z1SUQwZ2NYVmxkV1V1YkdWdVozUm9PMXh1SUNBZ0lIMWNiaUFnSUNCa2NtRnBibWx1WnlBOUlHWmhiSE5sTzF4dWZWeHVjSEp2WTJWemN5NXVaWGgwVkdsamF5QTlJR1oxYm1OMGFXOXVJQ2htZFc0cElIdGNiaUFnSUNCeGRXVjFaUzV3ZFhOb0tHWjFiaWs3WEc0Z0lDQWdhV1lnS0NGa2NtRnBibWx1WnlrZ2UxeHVJQ0FnSUNBZ0lDQnpaWFJVYVcxbGIzVjBLR1J5WVdsdVVYVmxkV1VzSURBcE8xeHVJQ0FnSUgxY2JuMDdYRzVjYm5CeWIyTmxjM011ZEdsMGJHVWdQU0FuWW5KdmQzTmxjaWM3WEc1d2NtOWpaWE56TG1KeWIzZHpaWElnUFNCMGNuVmxPMXh1Y0hKdlkyVnpjeTVsYm5ZZ1BTQjdmVHRjYm5CeWIyTmxjM011WVhKbmRpQTlJRnRkTzF4dWNISnZZMlZ6Y3k1MlpYSnphVzl1SUQwZ0p5YzdJQzh2SUdWdGNIUjVJSE4wY21sdVp5QjBieUJoZG05cFpDQnlaV2RsZUhBZ2FYTnpkV1Z6WEc1d2NtOWpaWE56TG5abGNuTnBiMjV6SUQwZ2UzMDdYRzVjYm1aMWJtTjBhVzl1SUc1dmIzQW9LU0I3ZlZ4dVhHNXdjbTlqWlhOekxtOXVJRDBnYm05dmNEdGNibkJ5YjJObGMzTXVZV1JrVEdsemRHVnVaWElnUFNCdWIyOXdPMXh1Y0hKdlkyVnpjeTV2Ym1ObElEMGdibTl2Y0R0Y2JuQnliMk5sYzNNdWIyWm1JRDBnYm05dmNEdGNibkJ5YjJObGMzTXVjbVZ0YjNabFRHbHpkR1Z1WlhJZ1BTQnViMjl3TzF4dWNISnZZMlZ6Y3k1eVpXMXZkbVZCYkd4TWFYTjBaVzVsY25NZ1BTQnViMjl3TzF4dWNISnZZMlZ6Y3k1bGJXbDBJRDBnYm05dmNEdGNibHh1Y0hKdlkyVnpjeTVpYVc1a2FXNW5JRDBnWm5WdVkzUnBiMjRnS0c1aGJXVXBJSHRjYmlBZ0lDQjBhSEp2ZHlCdVpYY2dSWEp5YjNJb0ozQnliMk5sYzNNdVltbHVaR2x1WnlCcGN5QnViM1FnYzNWd2NHOXlkR1ZrSnlrN1hHNTlPMXh1WEc0dkx5QlVUMFJQS0hOb2RIbHNiV0Z1S1Z4dWNISnZZMlZ6Y3k1amQyUWdQU0JtZFc1amRHbHZiaUFvS1NCN0lISmxkSFZ5YmlBbkx5Y2dmVHRjYm5CeWIyTmxjM011WTJoa2FYSWdQU0JtZFc1amRHbHZiaUFvWkdseUtTQjdYRzRnSUNBZ2RHaHliM2NnYm1WM0lFVnljbTl5S0Nkd2NtOWpaWE56TG1Ob1pHbHlJR2x6SUc1dmRDQnpkWEJ3YjNKMFpXUW5LVHRjYm4wN1hHNXdjbTlqWlhOekxuVnRZWE5ySUQwZ1puVnVZM1JwYjI0b0tTQjdJSEpsZEhWeWJpQXdPeUI5TzF4dUlsMTkiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4vKipcbiAqIE1vZHVsZSBjb25zdHJ1Y3RvclxuICogQHBhcmFtICB7T2JqZWN0fSB0YXJnZXQgVGFyZ2V0IG9iamVjdCB0byBleHRlbmRzIG1ldGhvZHMgYW5kIHByb3BlcnRpZXMgaW50b1xuICogQHJldHVybiB7T2JqZWN0fSAgICAgICAgVGFyZ2V0IGFmdGVyIHdpdGggZXh0ZW5kZWQgbWV0aG9kcyBhbmQgcHJvcGVydGllc1xuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICB0YXJnZXQgPSB0YXJnZXQgfHwge307XG4gIGZvcih2YXIgcHJvcCBpbiBIYXBwZW5zKVxuICAgIHRhcmdldFtwcm9wXSA9IEhhcHBlbnNbcHJvcF07XG4gIHJldHVybiB0YXJnZXQ7XG59O1xuXG5cblxuLyoqXG4gKiBDbGFzcyBIYXBwZW5zXG4gKiBAdHlwZSB7T2JqZWN0fVxuICovXG52YXIgSGFwcGVucyA9IHtcblxuICAvKipcbiAgICogSW5pdGlhbGl6ZXMgZXZlbnRcbiAgICogQHBhcmFtICB7U3RyaW5nfSBldmVudCBFdmVudCBuYW1lIHRvIGluaXRpYWxpemVcbiAgICogQHJldHVybiB7QXJyYXl9ICAgICAgICBJbml0aWFsaXplZCBldmVudCBwb29sXG4gICAqL1xuICBfX2luaXQ6IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgdmFyIHRtcCA9IHRoaXMuX19saXN0ZW5lcnMgfHwgKHRoaXMuX19saXN0ZW5lcnMgPSBbXSk7XG4gICAgcmV0dXJuIHRtcFtldmVudF0gfHwgKHRtcFtldmVudF0gPSBbXSk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEFkZHMgbGlzdGVuZXJcbiAgICogQHBhcmFtICB7U3RyaW5nfSAgIGV2ZW50IEV2ZW50IG5hbWVcbiAgICogQHBhcmFtICB7RnVuY3Rpb259IGZuICAgIEV2ZW50IGhhbmRsZXJcbiAgICovXG4gIG9uOiBmdW5jdGlvbihldmVudCwgZm4pIHtcbiAgICB2YWxpZGF0ZShmbik7XG4gICAgdGhpcy5fX2luaXQoZXZlbnQpLnB1c2goZm4pO1xuICB9LFxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGxpc3RlbmVyXG4gICAqIEBwYXJhbSAge1N0cmluZ30gICBldmVudCBFdmVudCBuYW1lXG4gICAqIEBwYXJhbSAge0Z1bmN0aW9ufSBmbiAgICBFdmVudCBoYW5kbGVyXG4gICAqL1xuICBvZmY6IGZ1bmN0aW9uKGV2ZW50LCBmbikge1xuICAgIHZhciBwb29sID0gdGhpcy5fX2luaXQoZXZlbnQpO1xuICAgIHBvb2wuc3BsaWNlKHBvb2wuaW5kZXhPZihmbiksIDEpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBBZGQgbGlzdGVuZXIgdGhlIGZpcmVzIG9uY2UgYW5kIGF1dG8tcmVtb3ZlcyBpdHNlbGZcbiAgICogQHBhcmFtICB7U3RyaW5nfSAgIGV2ZW50IEV2ZW50IG5hbWVcbiAgICogQHBhcmFtICB7RnVuY3Rpb259IGZuICAgIEV2ZW50IGhhbmRsZXJcbiAgICovXG4gIG9uY2U6IGZ1bmN0aW9uKGV2ZW50LCBmbikge1xuICAgIHZhbGlkYXRlKGZuKTtcbiAgICB2YXIgc2VsZiA9IHRoaXMsIHdyYXBwZXIgPSBmdW5jdGlvbigpIHtcbiAgICAgIHNlbGYub2ZmKGV2ZW50LCB3cmFwcGVyKTtcbiAgICAgIGZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgICB0aGlzLm9uKGV2ZW50LCB3cmFwcGVyICk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEVtaXQgc29tZSBldmVudFxuICAgKiBAcGFyYW0gIHtTdHJpbmd9IGV2ZW50IEV2ZW50IG5hbWUgLS0gc3Vic2VxdWVudCBwYXJhbXMgYWZ0ZXIgYGV2ZW50YCB3aWxsXG4gICAqIGJlIHBhc3NlZCBhbG9uZyB0byB0aGUgZXZlbnQncyBoYW5kbGVyc1xuICAgKi9cbiAgZW1pdDogZnVuY3Rpb24oZXZlbnQgLyosIGFyZzEsIGFyZzIgKi8gKSB7XG4gICAgdmFyIGksIHBvb2wgPSB0aGlzLl9faW5pdChldmVudCkuc2xpY2UoMCk7XG4gICAgZm9yKGkgaW4gcG9vbClcbiAgICAgIHBvb2xbaV0uYXBwbHkodGhpcywgW10uc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpKTtcbiAgfVxufTtcblxuXG5cbi8qKlxuICogVmFsaWRhdGVzIGlmIGEgZnVuY3Rpb24gZXhpc3RzIGFuZCBpcyBhbiBpbnN0YW5jZW9mIEZ1bmN0aW9uLCBhbmQgdGhyb3dzXG4gKiBhbiBlcnJvciBpZiBuZWVkZWRcbiAqIEBwYXJhbSAge0Z1bmN0aW9ufSBmbiBGdW5jdGlvbiB0byB2YWxpZGF0ZVxuICovXG5mdW5jdGlvbiB2YWxpZGF0ZShmbikge1xuICBpZighKGZuICYmIGZuIGluc3RhbmNlb2YgRnVuY3Rpb24pKVxuICAgIHRocm93IG5ldyBFcnJvcihmbiArICcgaXMgbm90IGEgRnVuY3Rpb24nKTtcbn1cbn0pLmNhbGwodGhpcyxyZXF1aXJlKCdfcHJvY2VzcycpLHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWwgOiB0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL25vZGVfbW9kdWxlcy9oYXBwZW5zL2luZGV4LmpzXCIsXCIvLi4vbm9kZV9tb2R1bGVzL2hhcHBlbnNcIilcbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWRhdGE6YXBwbGljYXRpb24vanNvbjtjaGFyc2V0OnV0Zi04O2Jhc2U2NCxleUoyWlhKemFXOXVJam96TENKemIzVnlZMlZ6SWpwYklpNHVMMjV2WkdWZmJXOWtkV3hsY3k5b1lYQndaVzV6TDJsdVpHVjRMbXB6SWwwc0ltNWhiV1Z6SWpwYlhTd2liV0Z3Y0dsdVozTWlPaUk3UVVGQlFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFaUxDSm1hV3hsSWpvaVoyVnVaWEpoZEdWa0xtcHpJaXdpYzI5MWNtTmxVbTl2ZENJNklpSXNJbk52ZFhKalpYTkRiMjUwWlc1MElqcGJJaThxS2x4dUlDb2dUVzlrZFd4bElHTnZibk4wY25WamRHOXlYRzRnS2lCQWNHRnlZVzBnSUh0UFltcGxZM1I5SUhSaGNtZGxkQ0JVWVhKblpYUWdiMkpxWldOMElIUnZJR1Y0ZEdWdVpITWdiV1YwYUc5a2N5QmhibVFnY0hKdmNHVnlkR2xsY3lCcGJuUnZYRzRnS2lCQWNtVjBkWEp1SUh0UFltcGxZM1I5SUNBZ0lDQWdJQ0JVWVhKblpYUWdZV1owWlhJZ2QybDBhQ0JsZUhSbGJtUmxaQ0J0WlhSb2IyUnpJR0Z1WkNCd2NtOXdaWEowYVdWelhHNGdLaTljYm0xdlpIVnNaUzVsZUhCdmNuUnpJRDBnWm5WdVkzUnBiMjRvZEdGeVoyVjBLU0I3WEc0Z0lIUmhjbWRsZENBOUlIUmhjbWRsZENCOGZDQjdmVHRjYmlBZ1ptOXlLSFpoY2lCd2NtOXdJR2x1SUVoaGNIQmxibk1wWEc0Z0lDQWdkR0Z5WjJWMFczQnliM0JkSUQwZ1NHRndjR1Z1YzF0d2NtOXdYVHRjYmlBZ2NtVjBkWEp1SUhSaGNtZGxkRHRjYm4wN1hHNWNibHh1WEc0dktpcGNiaUFxSUVOc1lYTnpJRWhoY0hCbGJuTmNiaUFxSUVCMGVYQmxJSHRQWW1wbFkzUjlYRzRnS2k5Y2JuWmhjaUJJWVhCd1pXNXpJRDBnZTF4dVhHNGdJQzhxS2x4dUlDQWdLaUJKYm1sMGFXRnNhWHBsY3lCbGRtVnVkRnh1SUNBZ0tpQkFjR0Z5WVcwZ0lIdFRkSEpwYm1kOUlHVjJaVzUwSUVWMlpXNTBJRzVoYldVZ2RHOGdhVzVwZEdsaGJHbDZaVnh1SUNBZ0tpQkFjbVYwZFhKdUlIdEJjbkpoZVgwZ0lDQWdJQ0FnSUVsdWFYUnBZV3hwZW1Wa0lHVjJaVzUwSUhCdmIyeGNiaUFnSUNvdlhHNGdJRjlmYVc1cGREb2dablZ1WTNScGIyNG9aWFpsYm5RcElIdGNiaUFnSUNCMllYSWdkRzF3SUQwZ2RHaHBjeTVmWDJ4cGMzUmxibVZ5Y3lCOGZDQW9kR2hwY3k1ZlgyeHBjM1JsYm1WeWN5QTlJRnRkS1R0Y2JpQWdJQ0J5WlhSMWNtNGdkRzF3VzJWMlpXNTBYU0I4ZkNBb2RHMXdXMlYyWlc1MFhTQTlJRnRkS1R0Y2JpQWdmU3hjYmx4dUlDQXZLaXBjYmlBZ0lDb2dRV1JrY3lCc2FYTjBaVzVsY2x4dUlDQWdLaUJBY0dGeVlXMGdJSHRUZEhKcGJtZDlJQ0FnWlhabGJuUWdSWFpsYm5RZ2JtRnRaVnh1SUNBZ0tpQkFjR0Z5WVcwZ0lIdEdkVzVqZEdsdmJuMGdabTRnSUNBZ1JYWmxiblFnYUdGdVpHeGxjbHh1SUNBZ0tpOWNiaUFnYjI0NklHWjFibU4wYVc5dUtHVjJaVzUwTENCbWJpa2dlMXh1SUNBZ0lIWmhiR2xrWVhSbEtHWnVLVHRjYmlBZ0lDQjBhR2x6TGw5ZmFXNXBkQ2hsZG1WdWRDa3VjSFZ6YUNobWJpazdYRzRnSUgwc1hHNWNiaUFnTHlvcVhHNGdJQ0FxSUZKbGJXOTJaWE1nYkdsemRHVnVaWEpjYmlBZ0lDb2dRSEJoY21GdElDQjdVM1J5YVc1bmZTQWdJR1YyWlc1MElFVjJaVzUwSUc1aGJXVmNiaUFnSUNvZ1FIQmhjbUZ0SUNCN1JuVnVZM1JwYjI1OUlHWnVJQ0FnSUVWMlpXNTBJR2hoYm1Sc1pYSmNiaUFnSUNvdlhHNGdJRzltWmpvZ1puVnVZM1JwYjI0b1pYWmxiblFzSUdadUtTQjdYRzRnSUNBZ2RtRnlJSEJ2YjJ3Z1BTQjBhR2x6TGw5ZmFXNXBkQ2hsZG1WdWRDazdYRzRnSUNBZ2NHOXZiQzV6Y0d4cFkyVW9jRzl2YkM1cGJtUmxlRTltS0dadUtTd2dNU2s3WEc0Z0lIMHNYRzVjYmlBZ0x5b3FYRzRnSUNBcUlFRmtaQ0JzYVhOMFpXNWxjaUIwYUdVZ1ptbHlaWE1nYjI1alpTQmhibVFnWVhWMGJ5MXlaVzF2ZG1WeklHbDBjMlZzWmx4dUlDQWdLaUJBY0dGeVlXMGdJSHRUZEhKcGJtZDlJQ0FnWlhabGJuUWdSWFpsYm5RZ2JtRnRaVnh1SUNBZ0tpQkFjR0Z5WVcwZ0lIdEdkVzVqZEdsdmJuMGdabTRnSUNBZ1JYWmxiblFnYUdGdVpHeGxjbHh1SUNBZ0tpOWNiaUFnYjI1alpUb2dablZ1WTNScGIyNG9aWFpsYm5Rc0lHWnVLU0I3WEc0Z0lDQWdkbUZzYVdSaGRHVW9abTRwTzF4dUlDQWdJSFpoY2lCelpXeG1JRDBnZEdocGN5d2dkM0poY0hCbGNpQTlJR1oxYm1OMGFXOXVLQ2tnZTF4dUlDQWdJQ0FnYzJWc1ppNXZabVlvWlhabGJuUXNJSGR5WVhCd1pYSXBPMXh1SUNBZ0lDQWdabTR1WVhCd2JIa29kR2hwY3l3Z1lYSm5kVzFsYm5SektUdGNiaUFnSUNCOU8xeHVJQ0FnSUhSb2FYTXViMjRvWlhabGJuUXNJSGR5WVhCd1pYSWdLVHRjYmlBZ2ZTeGNibHh1SUNBdktpcGNiaUFnSUNvZ1JXMXBkQ0J6YjIxbElHVjJaVzUwWEc0Z0lDQXFJRUJ3WVhKaGJTQWdlMU4wY21sdVozMGdaWFpsYm5RZ1JYWmxiblFnYm1GdFpTQXRMU0J6ZFdKelpYRjFaVzUwSUhCaGNtRnRjeUJoWm5SbGNpQmdaWFpsYm5SZ0lIZHBiR3hjYmlBZ0lDb2dZbVVnY0dGemMyVmtJR0ZzYjI1bklIUnZJSFJvWlNCbGRtVnVkQ2R6SUdoaGJtUnNaWEp6WEc0Z0lDQXFMMXh1SUNCbGJXbDBPaUJtZFc1amRHbHZiaWhsZG1WdWRDQXZLaXdnWVhKbk1Td2dZWEpuTWlBcUx5QXBJSHRjYmlBZ0lDQjJZWElnYVN3Z2NHOXZiQ0E5SUhSb2FYTXVYMTlwYm1sMEtHVjJaVzUwS1M1emJHbGpaU2d3S1R0Y2JpQWdJQ0JtYjNJb2FTQnBiaUJ3YjI5c0tWeHVJQ0FnSUNBZ2NHOXZiRnRwWFM1aGNIQnNlU2gwYUdsekxDQmJYUzV6YkdsalpTNWpZV3hzS0dGeVozVnRaVzUwY3l3Z01Ta3BPMXh1SUNCOVhHNTlPMXh1WEc1Y2JseHVMeW9xWEc0Z0tpQldZV3hwWkdGMFpYTWdhV1lnWVNCbWRXNWpkR2x2YmlCbGVHbHpkSE1nWVc1a0lHbHpJR0Z1SUdsdWMzUmhibU5sYjJZZ1JuVnVZM1JwYjI0c0lHRnVaQ0IwYUhKdmQzTmNiaUFxSUdGdUlHVnljbTl5SUdsbUlHNWxaV1JsWkZ4dUlDb2dRSEJoY21GdElDQjdSblZ1WTNScGIyNTlJR1p1SUVaMWJtTjBhVzl1SUhSdklIWmhiR2xrWVhSbFhHNGdLaTljYm1aMWJtTjBhVzl1SUhaaGJHbGtZWFJsS0dadUtTQjdYRzRnSUdsbUtDRW9abTRnSmlZZ1ptNGdhVzV6ZEdGdVkyVnZaaUJHZFc1amRHbHZiaWtwWEc0Z0lDQWdkR2h5YjNjZ2JtVjNJRVZ5Y205eUtHWnVJQ3NnSnlCcGN5QnViM1FnWVNCR2RXNWpkR2x2YmljcE8xeHVmU0pkZlE9PSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBMb2FkZXIsIFNlcXVlbmNlTG9hZGVyLCBjLCBoYXBwZW5zLFxuICBiaW5kID0gZnVuY3Rpb24oZm4sIG1lKXsgcmV0dXJuIGZ1bmN0aW9uKCl7IHJldHVybiBmbi5hcHBseShtZSwgYXJndW1lbnRzKTsgfTsgfTtcblxuaGFwcGVucyA9IHJlcXVpcmUoJ2hhcHBlbnMnKTtcblxuTG9hZGVyID0gcmVxdWlyZSgnLi9sb2FkaW5nL3N5bmNfbG9hZGVyJyk7XG5cbmMgPSByZXF1aXJlKCcuL2xvZycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNlcXVlbmNlTG9hZGVyID0gKGZ1bmN0aW9uKCkge1xuICBTZXF1ZW5jZUxvYWRlci5wcm90b3R5cGUucGF0aCA9ICcnO1xuXG4gIFNlcXVlbmNlTG9hZGVyLnByb3RvdHlwZS5wYWNrc19jb3VudCA9IDA7XG5cbiAgU2VxdWVuY2VMb2FkZXIucHJvdG90eXBlLnBhY2tzX3RvdGFsID0gMDtcblxuICBTZXF1ZW5jZUxvYWRlci5wcm90b3R5cGUucGVyY2VudF9sb2FkZWQgPSAwO1xuXG4gIGZ1bmN0aW9uIFNlcXVlbmNlTG9hZGVyKGZpbGUpIHtcbiAgICB0aGlzLnBhY2tzX2xvYWRlZCA9IGJpbmQodGhpcy5wYWNrc19sb2FkZWQsIHRoaXMpO1xuICAgIHRoaXMuZGF0YV9sb2FkZWQgPSBiaW5kKHRoaXMuZGF0YV9sb2FkZWQsIHRoaXMpO1xuICAgIGhhcHBlbnModGhpcyk7XG4gICAgdGhpcy5sb2FkZXIgPSBuZXcgTG9hZGVyO1xuICAgIHRoaXMubG9hZGVyLm9uY2UoJ2xvYWRlZCcsIHRoaXMuZGF0YV9sb2FkZWQpO1xuICB9XG5cbiAgU2VxdWVuY2VMb2FkZXIucHJvdG90eXBlLmxvYWQgPSBmdW5jdGlvbihmaWxlKSB7XG4gICAgdGhpcy5wYXRoID0gZmlsZS5zcGxpdCgnLycpO1xuICAgIHRoaXMucGF0aC5wb3AoKTtcbiAgICB0aGlzLnBhdGggPSB0aGlzLnBhdGguam9pbignLycpO1xuICAgIHRoaXMubG9hZGVyLmFkZCgnZGF0YScsIGZpbGUsICdqc29uJyk7XG4gICAgcmV0dXJuIHRoaXMubG9hZGVyLmxvYWQoKTtcbiAgfTtcblxuICBTZXF1ZW5jZUxvYWRlci5wcm90b3R5cGUuZGF0YV9sb2FkZWQgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmRhdGEgPSAodGhpcy5sb2FkZXIuZ2V0X2Fzc2V0KCdkYXRhJykpLmRhdGE7XG4gICAgdGhpcy5wYWNrc190b3RhbCA9IHRoaXMuZGF0YS50b3RhbF9wYWNrcztcbiAgICB0aGlzLmVtaXQoJ2RhdGE6bG9hZGVkJyk7XG4gICAgdGhpcy5sb2FkZXIub24oJ2xvYWRlZCcsIHRoaXMucGFja3NfbG9hZGVkKTtcbiAgICByZXR1cm4gdGhpcy5fbG9hZCgpO1xuICB9O1xuXG4gIFNlcXVlbmNlTG9hZGVyLnByb3RvdHlwZS5fbG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubG9hZGVyLmFkZCh0aGlzLnBhY2tzX2NvdW50ICsgXCIucGFja1wiLCB0aGlzLnBhdGggKyBcIi9cIiArIHRoaXMucGFja3NfY291bnQgKyBcIi5wYWNrXCIsICdiaW5hcnknKTtcbiAgICByZXR1cm4gdGhpcy5sb2FkZXIubG9hZCgpO1xuICB9O1xuXG4gIFNlcXVlbmNlTG9hZGVyLnByb3RvdHlwZS5kaXNwb3NlID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5sb2FkZXIub2ZmKCdsb2FkZWQnLCB0aGlzLnBhY2tzX2xvYWRlZCk7XG4gICAgdGhpcy5sb2FkZXIuZGlzcG9zZSgpO1xuICAgIGRlbGV0ZSB0aGlzLmxvYWRlcjtcbiAgICByZXR1cm4gdGhpcy5kYXRhID0gbnVsbDtcbiAgfTtcblxuICBTZXF1ZW5jZUxvYWRlci5wcm90b3R5cGUucGFja3NfbG9hZGVkID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGJsb2IsIGNvbmZpZywgZmlsZV9uYW1lLCBpLCBpbWFnZSwgaW1hZ2VzLCBqLCBsZW4sIG1wLCBwYWNrX2lkLCByZWY7XG4gICAgaW1hZ2VzID0gW107XG4gICAgcGFja19pZCA9IHRoaXMucGFja3NfY291bnQgKyBcIi5wYWNrXCI7XG4gICAgYmxvYiA9ICh0aGlzLmxvYWRlci5nZXRfYXNzZXQodGhpcy5wYWNrc19jb3VudCArIFwiLnBhY2tcIikpLmRhdGE7XG4gICAgY29uZmlnID0gdGhpcy5kYXRhWydmcmFtZXMnXVt0aGlzLnBhY2tzX2NvdW50XTtcbiAgICBtcCA9IG5ldyBNYWdpcGFjayhibG9iLCBjb25maWcpO1xuICAgIGxlbiA9IGNvbmZpZy5sZW5ndGg7XG4gICAgZm9yIChpID0gaiA9IDAsIHJlZiA9IGxlbjsgMCA8PSByZWYgPyBqIDwgcmVmIDogaiA+IHJlZjsgaSA9IDAgPD0gcmVmID8gKytqIDogLS1qKSB7XG4gICAgICBmaWxlX25hbWUgPSBjb25maWdbaV1bMF07XG4gICAgICBpbWFnZSA9IG5ldyBJbWFnZSgpO1xuICAgICAgaW1hZ2Uuc3JjID0gbXAuZ2V0VVJJKGZpbGVfbmFtZSk7XG4gICAgICBpbWFnZXMucHVzaChpbWFnZSk7XG4gICAgfVxuICAgIHRoaXMuZW1pdCgnYnVmZmVyOnVwZGF0ZScsIGltYWdlcyk7XG4gICAgdGhpcy5wYWNrc19jb3VudCsrO1xuICAgIHRoaXMucGVyY2VudF9sb2FkZWQgPSB0aGlzLnBhY2tzX2NvdW50IC8gdGhpcy5wYWNrc190b3RhbDtcbiAgICBjLmRlYnVnKFwiTG9hZGVkIFwiICsgdGhpcy5wYWNrc19jb3VudCArIFwiIC8gXCIgKyB0aGlzLmRhdGEudG90YWxfcGFja3MpO1xuICAgIGlmICh0aGlzLnBhY2tzX2NvdW50ID49IHRoaXMucGFja3NfdG90YWwpIHtcbiAgICAgIHJldHVybiB0aGlzLmVtaXQoJ2J1ZmZlcjpjb21wbGV0ZScpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdGhpcy5fbG9hZCgpO1xuICAgIH1cbiAgfTtcblxuICByZXR1cm4gU2VxdWVuY2VMb2FkZXI7XG5cbn0pKCk7XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKCdfcHJvY2VzcycpLHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWwgOiB0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiL2xvYWRlci5jb2ZmZWVcIixcIi9cIilcbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWRhdGE6YXBwbGljYXRpb24vanNvbjtjaGFyc2V0OnV0Zi04O2Jhc2U2NCxleUoyWlhKemFXOXVJam96TENKemIzVnlZMlZ6SWpwYklteHZZV1JsY2k1amIyWm1aV1VpWFN3aWJtRnRaWE1pT2x0ZExDSnRZWEJ3YVc1bmN5STZJanRCUVVGQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEVpTENKbWFXeGxJam9pWjJWdVpYSmhkR1ZrTG1weklpd2ljMjkxY21ObFVtOXZkQ0k2SWlJc0luTnZkWEpqWlhORGIyNTBaVzUwSWpwYkluWmhjaUJNYjJGa1pYSXNJRk5sY1hWbGJtTmxURzloWkdWeUxDQmpMQ0JvWVhCd1pXNXpMRnh1SUNCaWFXNWtJRDBnWm5WdVkzUnBiMjRvWm00c0lHMWxLWHNnY21WMGRYSnVJR1oxYm1OMGFXOXVLQ2w3SUhKbGRIVnliaUJtYmk1aGNIQnNlU2h0WlN3Z1lYSm5kVzFsYm5SektUc2dmVHNnZlR0Y2JseHVhR0Z3Y0dWdWN5QTlJSEpsY1hWcGNtVW9KMmhoY0hCbGJuTW5LVHRjYmx4dVRHOWhaR1Z5SUQwZ2NtVnhkV2x5WlNnbkxpOXNiMkZrYVc1bkwzTjVibU5mYkc5aFpHVnlKeWs3WEc1Y2JtTWdQU0J5WlhGMWFYSmxLQ2N1TDJ4dlp5Y3BPMXh1WEc1dGIyUjFiR1V1Wlhod2IzSjBjeUE5SUZObGNYVmxibU5sVEc5aFpHVnlJRDBnS0daMWJtTjBhVzl1S0NrZ2UxeHVJQ0JUWlhGMVpXNWpaVXh2WVdSbGNpNXdjbTkwYjNSNWNHVXVjR0YwYUNBOUlDY25PMXh1WEc0Z0lGTmxjWFZsYm1ObFRHOWhaR1Z5TG5CeWIzUnZkSGx3WlM1d1lXTnJjMTlqYjNWdWRDQTlJREE3WEc1Y2JpQWdVMlZ4ZFdWdVkyVk1iMkZrWlhJdWNISnZkRzkwZVhCbExuQmhZMnR6WDNSdmRHRnNJRDBnTUR0Y2JseHVJQ0JUWlhGMVpXNWpaVXh2WVdSbGNpNXdjbTkwYjNSNWNHVXVjR1Z5WTJWdWRGOXNiMkZrWldRZ1BTQXdPMXh1WEc0Z0lHWjFibU4wYVc5dUlGTmxjWFZsYm1ObFRHOWhaR1Z5S0dacGJHVXBJSHRjYmlBZ0lDQjBhR2x6TG5CaFkydHpYMnh2WVdSbFpDQTlJR0pwYm1Rb2RHaHBjeTV3WVdOcmMxOXNiMkZrWldRc0lIUm9hWE1wTzF4dUlDQWdJSFJvYVhNdVpHRjBZVjlzYjJGa1pXUWdQU0JpYVc1a0tIUm9hWE11WkdGMFlWOXNiMkZrWldRc0lIUm9hWE1wTzF4dUlDQWdJR2hoY0hCbGJuTW9kR2hwY3lrN1hHNGdJQ0FnZEdocGN5NXNiMkZrWlhJZ1BTQnVaWGNnVEc5aFpHVnlPMXh1SUNBZ0lIUm9hWE11Ykc5aFpHVnlMbTl1WTJVb0oyeHZZV1JsWkNjc0lIUm9hWE11WkdGMFlWOXNiMkZrWldRcE8xeHVJQ0I5WEc1Y2JpQWdVMlZ4ZFdWdVkyVk1iMkZrWlhJdWNISnZkRzkwZVhCbExteHZZV1FnUFNCbWRXNWpkR2x2YmlobWFXeGxLU0I3WEc0Z0lDQWdkR2hwY3k1d1lYUm9JRDBnWm1sc1pTNXpjR3hwZENnbkx5Y3BPMXh1SUNBZ0lIUm9hWE11Y0dGMGFDNXdiM0FvS1R0Y2JpQWdJQ0IwYUdsekxuQmhkR2dnUFNCMGFHbHpMbkJoZEdndWFtOXBiaWduTHljcE8xeHVJQ0FnSUhSb2FYTXViRzloWkdWeUxtRmtaQ2duWkdGMFlTY3NJR1pwYkdVc0lDZHFjMjl1SnlrN1hHNGdJQ0FnY21WMGRYSnVJSFJvYVhNdWJHOWhaR1Z5TG14dllXUW9LVHRjYmlBZ2ZUdGNibHh1SUNCVFpYRjFaVzVqWlV4dllXUmxjaTV3Y205MGIzUjVjR1V1WkdGMFlWOXNiMkZrWldRZ1BTQm1kVzVqZEdsdmJpZ3BJSHRjYmlBZ0lDQjBhR2x6TG1SaGRHRWdQU0FvZEdocGN5NXNiMkZrWlhJdVoyVjBYMkZ6YzJWMEtDZGtZWFJoSnlrcExtUmhkR0U3WEc0Z0lDQWdkR2hwY3k1d1lXTnJjMTkwYjNSaGJDQTlJSFJvYVhNdVpHRjBZUzUwYjNSaGJGOXdZV05yY3p0Y2JpQWdJQ0IwYUdsekxtVnRhWFFvSjJSaGRHRTZiRzloWkdWa0p5azdYRzRnSUNBZ2RHaHBjeTVzYjJGa1pYSXViMjRvSjJ4dllXUmxaQ2NzSUhSb2FYTXVjR0ZqYTNOZmJHOWhaR1ZrS1R0Y2JpQWdJQ0J5WlhSMWNtNGdkR2hwY3k1ZmJHOWhaQ2dwTzF4dUlDQjlPMXh1WEc0Z0lGTmxjWFZsYm1ObFRHOWhaR1Z5TG5CeWIzUnZkSGx3WlM1ZmJHOWhaQ0E5SUdaMWJtTjBhVzl1S0NrZ2UxeHVJQ0FnSUhSb2FYTXViRzloWkdWeUxtRmtaQ2gwYUdsekxuQmhZMnR6WDJOdmRXNTBJQ3NnWENJdWNHRmphMXdpTENCMGFHbHpMbkJoZEdnZ0t5QmNJaTljSWlBcklIUm9hWE11Y0dGamEzTmZZMjkxYm5RZ0t5QmNJaTV3WVdOclhDSXNJQ2RpYVc1aGNua25LVHRjYmlBZ0lDQnlaWFIxY200Z2RHaHBjeTVzYjJGa1pYSXViRzloWkNncE8xeHVJQ0I5TzF4dVhHNGdJRk5sY1hWbGJtTmxURzloWkdWeUxuQnliM1J2ZEhsd1pTNWthWE53YjNObElEMGdablZ1WTNScGIyNG9LU0I3WEc0Z0lDQWdkR2hwY3k1c2IyRmtaWEl1YjJabUtDZHNiMkZrWldRbkxDQjBhR2x6TG5CaFkydHpYMnh2WVdSbFpDazdYRzRnSUNBZ2RHaHBjeTVzYjJGa1pYSXVaR2x6Y0c5elpTZ3BPMXh1SUNBZ0lHUmxiR1YwWlNCMGFHbHpMbXh2WVdSbGNqdGNiaUFnSUNCeVpYUjFjbTRnZEdocGN5NWtZWFJoSUQwZ2JuVnNiRHRjYmlBZ2ZUdGNibHh1SUNCVFpYRjFaVzVqWlV4dllXUmxjaTV3Y205MGIzUjVjR1V1Y0dGamEzTmZiRzloWkdWa0lEMGdablZ1WTNScGIyNG9LU0I3WEc0Z0lDQWdkbUZ5SUdKc2IySXNJR052Ym1acFp5d2dabWxzWlY5dVlXMWxMQ0JwTENCcGJXRm5aU3dnYVcxaFoyVnpMQ0JxTENCc1pXNHNJRzF3TENCd1lXTnJYMmxrTENCeVpXWTdYRzRnSUNBZ2FXMWhaMlZ6SUQwZ1cxMDdYRzRnSUNBZ2NHRmphMTlwWkNBOUlIUm9hWE11Y0dGamEzTmZZMjkxYm5RZ0t5QmNJaTV3WVdOclhDSTdYRzRnSUNBZ1lteHZZaUE5SUNoMGFHbHpMbXh2WVdSbGNpNW5aWFJmWVhOelpYUW9kR2hwY3k1d1lXTnJjMTlqYjNWdWRDQXJJRndpTG5CaFkydGNJaWtwTG1SaGRHRTdYRzRnSUNBZ1kyOXVabWxuSUQwZ2RHaHBjeTVrWVhSaFd5ZG1jbUZ0WlhNblhWdDBhR2x6TG5CaFkydHpYMk52ZFc1MFhUdGNiaUFnSUNCdGNDQTlJRzVsZHlCTllXZHBjR0ZqYXloaWJHOWlMQ0JqYjI1bWFXY3BPMXh1SUNBZ0lHeGxiaUE5SUdOdmJtWnBaeTVzWlc1bmRHZzdYRzRnSUNBZ1ptOXlJQ2hwSUQwZ2FpQTlJREFzSUhKbFppQTlJR3hsYmpzZ01DQThQU0J5WldZZ1B5QnFJRHdnY21WbUlEb2dhaUErSUhKbFpqc2dhU0E5SURBZ1BEMGdjbVZtSUQ4Z0t5dHFJRG9nTFMxcUtTQjdYRzRnSUNBZ0lDQm1hV3hsWDI1aGJXVWdQU0JqYjI1bWFXZGJhVjFiTUYwN1hHNGdJQ0FnSUNCcGJXRm5aU0E5SUc1bGR5QkpiV0ZuWlNncE8xeHVJQ0FnSUNBZ2FXMWhaMlV1YzNKaklEMGdiWEF1WjJWMFZWSkpLR1pwYkdWZmJtRnRaU2s3WEc0Z0lDQWdJQ0JwYldGblpYTXVjSFZ6YUNocGJXRm5aU2s3WEc0Z0lDQWdmVnh1SUNBZ0lIUm9hWE11WlcxcGRDZ25ZblZtWm1WeU9uVndaR0YwWlNjc0lHbHRZV2RsY3lrN1hHNGdJQ0FnZEdocGN5NXdZV05yYzE5amIzVnVkQ3NyTzF4dUlDQWdJSFJvYVhNdWNHVnlZMlZ1ZEY5c2IyRmtaV1FnUFNCMGFHbHpMbkJoWTJ0elgyTnZkVzUwSUM4Z2RHaHBjeTV3WVdOcmMxOTBiM1JoYkR0Y2JpQWdJQ0JqTG1SbFluVm5LRndpVEc5aFpHVmtJRndpSUNzZ2RHaHBjeTV3WVdOcmMxOWpiM1Z1ZENBcklGd2lJQzhnWENJZ0t5QjBhR2x6TG1SaGRHRXVkRzkwWVd4ZmNHRmphM01wTzF4dUlDQWdJR2xtSUNoMGFHbHpMbkJoWTJ0elgyTnZkVzUwSUQ0OUlIUm9hWE11Y0dGamEzTmZkRzkwWVd3cElIdGNiaUFnSUNBZ0lISmxkSFZ5YmlCMGFHbHpMbVZ0YVhRb0oySjFabVpsY2pwamIyMXdiR1YwWlNjcE8xeHVJQ0FnSUgwZ1pXeHpaU0I3WEc0Z0lDQWdJQ0J5WlhSMWNtNGdkR2hwY3k1ZmJHOWhaQ2dwTzF4dUlDQWdJSDFjYmlBZ2ZUdGNibHh1SUNCeVpYUjFjbTRnVTJWeGRXVnVZMlZNYjJGa1pYSTdYRzVjYm4wcEtDazdYRzRpWFgwPSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBBc3luY0xvYWRlciwgQmluYXJ5TG9hZGVyLCBEYXRhTG9hZGVyLCBoYXBwZW5zLFxuICBiaW5kID0gZnVuY3Rpb24oZm4sIG1lKXsgcmV0dXJuIGZ1bmN0aW9uKCl7IHJldHVybiBmbi5hcHBseShtZSwgYXJndW1lbnRzKTsgfTsgfTtcblxuaGFwcGVucyA9IHJlcXVpcmUoJ2hhcHBlbnMnKTtcblxuRGF0YUxvYWRlciA9IHJlcXVpcmUoJy4vZGF0YV9sb2FkZXInKTtcblxuQmluYXJ5TG9hZGVyID0gcmVxdWlyZSgnLi9iaW5hcnlfbG9hZGVyJyk7XG5cblxuLypcbkxvYWQgZmlsZXMgYXN5bmNocm9ub3VzbHlcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IEFzeW5jTG9hZGVyID0gKGZ1bmN0aW9uKCkge1xuICBmdW5jdGlvbiBBc3luY0xvYWRlcigpIHtcbiAgICB0aGlzLmVycm9yID0gYmluZCh0aGlzLmVycm9yLCB0aGlzKTtcbiAgICB0aGlzLnN1Y2Nlc3MgPSBiaW5kKHRoaXMuc3VjY2VzcywgdGhpcyk7XG4gICAgaGFwcGVucyh0aGlzKTtcbiAgICB0aGlzLm1hbmlmZXN0ID0gW107XG4gIH1cblxuICBBc3luY0xvYWRlci5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oaWQsIGZpbGUsIHR5cGUsIGRhdGEpIHtcbiAgICB2YXIgb2JqO1xuICAgIG9iaiA9IHtcbiAgICAgIGlkOiBpZCxcbiAgICAgIHNyYzogZmlsZSxcbiAgICAgIHR5cGU6IHR5cGUsXG4gICAgICBkYXRhOiBkYXRhXG4gICAgfTtcbiAgICByZXR1cm4gdGhpcy5tYW5pZmVzdC5wdXNoKG9iaik7XG4gIH07XG5cbiAgQXN5bmNMb2FkZXIucHJvdG90eXBlLmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXNzZXQsIGksIGwsIGxlbiwgcmVmLCByZXN1bHRzO1xuICAgIHRoaXMuY291bnQgPSAwO1xuICAgIHRoaXMudG90YWwgPSB0aGlzLm1hbmlmZXN0Lmxlbmd0aDtcbiAgICB0aGlzLmRhdGUgPSBuZXcgRGF0ZSgpO1xuICAgIHJlZiA9IHRoaXMubWFuaWZlc3Q7XG4gICAgcmVzdWx0cyA9IFtdO1xuICAgIGZvciAoaSA9IDAsIGxlbiA9IHJlZi5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgYXNzZXQgPSByZWZbaV07XG4gICAgICBzd2l0Y2ggKGFzc2V0LnR5cGUpIHtcbiAgICAgICAgY2FzZSAnanNvbic6XG4gICAgICAgIGNhc2UgJ3htbCc6XG4gICAgICAgICAgbCA9IG5ldyBEYXRhTG9hZGVyO1xuICAgICAgICAgIGwub25jZSgnbG9hZGVkJywgdGhpcy5zdWNjZXNzKTtcbiAgICAgICAgICByZXN1bHRzLnB1c2gobC5sb2FkKGFzc2V0KSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgICAgbCA9IG5ldyBCaW5hcnlMb2FkZXI7XG4gICAgICAgICAgbC5vbmNlKCdsb2FkZWQnLCB0aGlzLnN1Y2Nlc3MpO1xuICAgICAgICAgIHJlc3VsdHMucHVzaChsLmxvYWQoYXNzZXQpKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICByZXN1bHRzLnB1c2godm9pZCAwKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdHM7XG4gIH07XG5cbiAgQXN5bmNMb2FkZXIucHJvdG90eXBlLnN1Y2Nlc3MgPSBmdW5jdGlvbihhc3NldCkge1xuICAgIHRoaXMuY291bnQrKztcbiAgICBpZiAodGhpcy5jb3VudCA+PSB0aGlzLnRvdGFsKSB7XG4gICAgICBjLmRlYnVnKCdMb2FkZWQgaW4nLCAobmV3IERhdGUoKSAtIHRoaXMuZGF0ZSkgLyAxMDAwKTtcbiAgICAgIHJldHVybiB0aGlzLmVtaXQoJ2xvYWRlZCcsIHRoaXMubWFuaWZlc3QpO1xuICAgIH1cbiAgfTtcblxuICBBc3luY0xvYWRlci5wcm90b3R5cGUuZXJyb3IgPSBmdW5jdGlvbihlcnJvcikge1xuICAgIHJldHVybiBjLmxvZygnZXJyb3InLCBlcnJvcik7XG4gIH07XG5cbiAgQXN5bmNMb2FkZXIucHJvdG90eXBlLmdldF9hc3NldCA9IGZ1bmN0aW9uKGlkKSB7XG4gICAgdmFyIGFzc2V0LCBpLCBsZW4sIHJlZiwgcmVzdWx0O1xuICAgIHJlc3VsdCA9IGZhbHNlO1xuICAgIHJlZiA9IHRoaXMubWFuaWZlc3Q7XG4gICAgZm9yIChpID0gMCwgbGVuID0gcmVmLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICBhc3NldCA9IHJlZltpXTtcbiAgICAgIGlmIChhc3NldC5pZC5tYXRjaChpZCkpIHtcbiAgICAgICAgcmVzdWx0ID0gYXNzZXQ7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgQXN5bmNMb2FkZXIucHJvdG90eXBlLmRpc3Bvc2UgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5tYW5pZmVzdCA9IFtdO1xuICB9O1xuXG4gIHJldHVybiBBc3luY0xvYWRlcjtcblxufSkoKTtcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoJ19wcm9jZXNzJyksdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvbG9hZGluZy9hc3luY19sb2FkZXIuY29mZmVlXCIsXCIvbG9hZGluZ1wiKVxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9ZGF0YTphcHBsaWNhdGlvbi9qc29uO2NoYXJzZXQ6dXRmLTg7YmFzZTY0LGV5SjJaWEp6YVc5dUlqb3pMQ0p6YjNWeVkyVnpJanBiSW14dllXUnBibWN2WVhONWJtTmZiRzloWkdWeUxtTnZabVpsWlNKZExDSnVZVzFsY3lJNlcxMHNJbTFoY0hCcGJtZHpJam9pTzBGQlFVRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFaUxDSm1hV3hsSWpvaVoyVnVaWEpoZEdWa0xtcHpJaXdpYzI5MWNtTmxVbTl2ZENJNklpSXNJbk52ZFhKalpYTkRiMjUwWlc1MElqcGJJblpoY2lCQmMzbHVZMHh2WVdSbGNpd2dRbWx1WVhKNVRHOWhaR1Z5TENCRVlYUmhURzloWkdWeUxDQm9ZWEJ3Wlc1ekxGeHVJQ0JpYVc1a0lEMGdablZ1WTNScGIyNG9abTRzSUcxbEtYc2djbVYwZFhKdUlHWjFibU4wYVc5dUtDbDdJSEpsZEhWeWJpQm1iaTVoY0hCc2VTaHRaU3dnWVhKbmRXMWxiblJ6S1RzZ2ZUc2dmVHRjYmx4dWFHRndjR1Z1Y3lBOUlISmxjWFZwY21Vb0oyaGhjSEJsYm5NbktUdGNibHh1UkdGMFlVeHZZV1JsY2lBOUlISmxjWFZwY21Vb0p5NHZaR0YwWVY5c2IyRmtaWEluS1R0Y2JseHVRbWx1WVhKNVRHOWhaR1Z5SUQwZ2NtVnhkV2x5WlNnbkxpOWlhVzVoY25sZmJHOWhaR1Z5SnlrN1hHNWNibHh1THlwY2JreHZZV1FnWm1sc1pYTWdZWE41Ym1Ob2NtOXViM1Z6YkhsY2JpQXFMMXh1WEc1dGIyUjFiR1V1Wlhod2IzSjBjeUE5SUVGemVXNWpURzloWkdWeUlEMGdLR1oxYm1OMGFXOXVLQ2tnZTF4dUlDQm1kVzVqZEdsdmJpQkJjM2x1WTB4dllXUmxjaWdwSUh0Y2JpQWdJQ0IwYUdsekxtVnljbTl5SUQwZ1ltbHVaQ2gwYUdsekxtVnljbTl5TENCMGFHbHpLVHRjYmlBZ0lDQjBhR2x6TG5OMVkyTmxjM01nUFNCaWFXNWtLSFJvYVhNdWMzVmpZMlZ6Y3l3Z2RHaHBjeWs3WEc0Z0lDQWdhR0Z3Y0dWdWN5aDBhR2x6S1R0Y2JpQWdJQ0IwYUdsekxtMWhibWxtWlhOMElEMGdXMTA3WEc0Z0lIMWNibHh1SUNCQmMzbHVZMHh2WVdSbGNpNXdjbTkwYjNSNWNHVXVZV1JrSUQwZ1puVnVZM1JwYjI0b2FXUXNJR1pwYkdVc0lIUjVjR1VzSUdSaGRHRXBJSHRjYmlBZ0lDQjJZWElnYjJKcU8xeHVJQ0FnSUc5aWFpQTlJSHRjYmlBZ0lDQWdJR2xrT2lCcFpDeGNiaUFnSUNBZ0lITnlZem9nWm1sc1pTeGNiaUFnSUNBZ0lIUjVjR1U2SUhSNWNHVXNYRzRnSUNBZ0lDQmtZWFJoT2lCa1lYUmhYRzRnSUNBZ2ZUdGNiaUFnSUNCeVpYUjFjbTRnZEdocGN5NXRZVzVwWm1WemRDNXdkWE5vS0c5aWFpazdYRzRnSUgwN1hHNWNiaUFnUVhONWJtTk1iMkZrWlhJdWNISnZkRzkwZVhCbExteHZZV1FnUFNCbWRXNWpkR2x2YmlncElIdGNiaUFnSUNCMllYSWdZWE56WlhRc0lHa3NJR3dzSUd4bGJpd2djbVZtTENCeVpYTjFiSFJ6TzF4dUlDQWdJSFJvYVhNdVkyOTFiblFnUFNBd08xeHVJQ0FnSUhSb2FYTXVkRzkwWVd3Z1BTQjBhR2x6TG0xaGJtbG1aWE4wTG14bGJtZDBhRHRjYmlBZ0lDQjBhR2x6TG1SaGRHVWdQU0J1WlhjZ1JHRjBaU2dwTzF4dUlDQWdJSEpsWmlBOUlIUm9hWE11YldGdWFXWmxjM1E3WEc0Z0lDQWdjbVZ6ZFd4MGN5QTlJRnRkTzF4dUlDQWdJR1p2Y2lBb2FTQTlJREFzSUd4bGJpQTlJSEpsWmk1c1pXNW5kR2c3SUdrZ1BDQnNaVzQ3SUdrckt5a2dlMXh1SUNBZ0lDQWdZWE56WlhRZ1BTQnlaV1piYVYwN1hHNGdJQ0FnSUNCemQybDBZMmdnS0dGemMyVjBMblI1Y0dVcElIdGNiaUFnSUNBZ0lDQWdZMkZ6WlNBbmFuTnZiaWM2WEc0Z0lDQWdJQ0FnSUdOaGMyVWdKM2h0YkNjNlhHNGdJQ0FnSUNBZ0lDQWdiQ0E5SUc1bGR5QkVZWFJoVEc5aFpHVnlPMXh1SUNBZ0lDQWdJQ0FnSUd3dWIyNWpaU2duYkc5aFpHVmtKeXdnZEdocGN5NXpkV05qWlhOektUdGNiaUFnSUNBZ0lDQWdJQ0J5WlhOMWJIUnpMbkIxYzJnb2JDNXNiMkZrS0dGemMyVjBLU2s3WEc0Z0lDQWdJQ0FnSUNBZ1luSmxZV3M3WEc0Z0lDQWdJQ0FnSUdOaGMyVWdKMkpwYm1GeWVTYzZYRzRnSUNBZ0lDQWdJQ0FnYkNBOUlHNWxkeUJDYVc1aGNubE1iMkZrWlhJN1hHNGdJQ0FnSUNBZ0lDQWdiQzV2Ym1ObEtDZHNiMkZrWldRbkxDQjBhR2x6TG5OMVkyTmxjM01wTzF4dUlDQWdJQ0FnSUNBZ0lISmxjM1ZzZEhNdWNIVnphQ2hzTG14dllXUW9ZWE56WlhRcEtUdGNiaUFnSUNBZ0lDQWdJQ0JpY21WaGF6dGNiaUFnSUNBZ0lDQWdaR1ZtWVhWc2REcGNiaUFnSUNBZ0lDQWdJQ0J5WlhOMWJIUnpMbkIxYzJnb2RtOXBaQ0F3S1R0Y2JpQWdJQ0FnSUgxY2JpQWdJQ0I5WEc0Z0lDQWdjbVYwZFhKdUlISmxjM1ZzZEhNN1hHNGdJSDA3WEc1Y2JpQWdRWE41Ym1OTWIyRmtaWEl1Y0hKdmRHOTBlWEJsTG5OMVkyTmxjM01nUFNCbWRXNWpkR2x2YmloaGMzTmxkQ2tnZTF4dUlDQWdJSFJvYVhNdVkyOTFiblFyS3p0Y2JpQWdJQ0JwWmlBb2RHaHBjeTVqYjNWdWRDQStQU0IwYUdsekxuUnZkR0ZzS1NCN1hHNGdJQ0FnSUNCakxtUmxZblZuS0NkTWIyRmtaV1FnYVc0bkxDQW9ibVYzSUVSaGRHVW9LU0F0SUhSb2FYTXVaR0YwWlNrZ0x5QXhNREF3S1R0Y2JpQWdJQ0FnSUhKbGRIVnliaUIwYUdsekxtVnRhWFFvSjJ4dllXUmxaQ2NzSUhSb2FYTXViV0Z1YVdabGMzUXBPMXh1SUNBZ0lIMWNiaUFnZlR0Y2JseHVJQ0JCYzNsdVkweHZZV1JsY2k1d2NtOTBiM1I1Y0dVdVpYSnliM0lnUFNCbWRXNWpkR2x2YmlobGNuSnZjaWtnZTF4dUlDQWdJSEpsZEhWeWJpQmpMbXh2WnlnblpYSnliM0luTENCbGNuSnZjaWs3WEc0Z0lIMDdYRzVjYmlBZ1FYTjVibU5NYjJGa1pYSXVjSEp2ZEc5MGVYQmxMbWRsZEY5aGMzTmxkQ0E5SUdaMWJtTjBhVzl1S0dsa0tTQjdYRzRnSUNBZ2RtRnlJR0Z6YzJWMExDQnBMQ0JzWlc0c0lISmxaaXdnY21WemRXeDBPMXh1SUNBZ0lISmxjM1ZzZENBOUlHWmhiSE5sTzF4dUlDQWdJSEpsWmlBOUlIUm9hWE11YldGdWFXWmxjM1E3WEc0Z0lDQWdabTl5SUNocElEMGdNQ3dnYkdWdUlEMGdjbVZtTG14bGJtZDBhRHNnYVNBOElHeGxianNnYVNzcktTQjdYRzRnSUNBZ0lDQmhjM05sZENBOUlISmxabHRwWFR0Y2JpQWdJQ0FnSUdsbUlDaGhjM05sZEM1cFpDNXRZWFJqYUNocFpDa3BJSHRjYmlBZ0lDQWdJQ0FnY21WemRXeDBJRDBnWVhOelpYUTdYRzRnSUNBZ0lDQjlYRzRnSUNBZ2ZWeHVJQ0FnSUhKbGRIVnliaUJ5WlhOMWJIUTdYRzRnSUgwN1hHNWNiaUFnUVhONWJtTk1iMkZrWlhJdWNISnZkRzkwZVhCbExtUnBjM0J2YzJVZ1BTQm1kVzVqZEdsdmJpZ3BJSHRjYmlBZ0lDQnlaWFIxY200Z2RHaHBjeTV0WVc1cFptVnpkQ0E5SUZ0ZE8xeHVJQ0I5TzF4dVhHNGdJSEpsZEhWeWJpQkJjM2x1WTB4dllXUmxjanRjYmx4dWZTa29LVHRjYmlKZGZRPT0iLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgQmluYXJ5TG9hZGVyLCBoYXBwZW5zO1xuXG5oYXBwZW5zID0gcmVxdWlyZSgnaGFwcGVucycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJpbmFyeUxvYWRlciA9IChmdW5jdGlvbigpIHtcbiAgZnVuY3Rpb24gQmluYXJ5TG9hZGVyKCkge1xuICAgIGhhcHBlbnModGhpcyk7XG4gIH1cblxuICBCaW5hcnlMb2FkZXIucHJvdG90eXBlLmxvYWQgPSBmdW5jdGlvbihhc3NldCkge1xuICAgIHZhciB0eXBlLCB4aHI7XG4gICAgeGhyID0gdGhpcy5yZXEoKTtcbiAgICBpZiAoIXR5cGUpIHtcbiAgICAgIHR5cGUgPSBcImFycmF5YnVmZmVyXCI7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoQmxvYi5wcm90b3R5cGUuc2xpY2UpIHtcbiAgICAgICAgICB0eXBlID0gXCJibG9iXCI7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKF9lcnJvcikge31cbiAgICB9XG4gICAgeGhyLm9wZW4oXCJHRVRcIiwgYXNzZXQuc3JjLCB0cnVlKTtcbiAgICB4aHIucmVzcG9uc2VUeXBlID0gdHlwZTtcbiAgICB4aHIub25wcm9ncmVzcyA9IGZ1bmN0aW9uKGUpIHt9O1xuICAgIHhoci5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gdGhpcy5lbWl0KCdlcnJvcicsIHhoci5zdGF0dXMpO1xuICAgIH07XG4gICAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IChmdW5jdGlvbihfdGhpcykge1xuICAgICAgcmV0dXJuIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgaWYgKHhoci5yZWFkeVN0YXRlID09PSA0KSB7XG4gICAgICAgICAgYXNzZXQuZGF0YSA9IHhoci5yZXNwb25zZTtcbiAgICAgICAgICBfdGhpcy5lbWl0KCdsb2FkZWQnLCBhc3NldCk7XG4gICAgICAgICAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfSkodGhpcyk7XG4gICAgcmV0dXJuIHhoci5zZW5kKG51bGwpO1xuICB9O1xuXG4gIEJpbmFyeUxvYWRlci5wcm90b3R5cGUucmVxID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKHdpbmRvdy5YTUxIdHRwUmVxdWVzdCkge1xuICAgICAgcmV0dXJuIG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuICAgIH1cbiAgICBpZiAod2luZG93LkFjdGl2ZVhPYmplY3QpIHtcbiAgICAgIHJldHVybiBuZXcgQWN0aXZlWE9iamVjdChcIk1TWE1MMi5YTUxIVFRQLjMuMFwiKTtcbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIEJpbmFyeUxvYWRlcjtcblxufSkoKTtcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoJ19wcm9jZXNzJyksdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvbG9hZGluZy9iaW5hcnlfbG9hZGVyLmNvZmZlZVwiLFwiL2xvYWRpbmdcIilcbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWRhdGE6YXBwbGljYXRpb24vanNvbjtjaGFyc2V0OnV0Zi04O2Jhc2U2NCxleUoyWlhKemFXOXVJam96TENKemIzVnlZMlZ6SWpwYklteHZZV1JwYm1jdlltbHVZWEo1WDJ4dllXUmxjaTVqYjJabVpXVWlYU3dpYm1GdFpYTWlPbHRkTENKdFlYQndhVzVuY3lJNklqdEJRVUZCTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRU0lzSW1acGJHVWlPaUpuWlc1bGNtRjBaV1F1YW5NaUxDSnpiM1Z5WTJWU2IyOTBJam9pSWl3aWMyOTFjbU5sYzBOdmJuUmxiblFpT2xzaWRtRnlJRUpwYm1GeWVVeHZZV1JsY2l3Z2FHRndjR1Z1Y3p0Y2JseHVhR0Z3Y0dWdWN5QTlJSEpsY1hWcGNtVW9KMmhoY0hCbGJuTW5LVHRjYmx4dWJXOWtkV3hsTG1WNGNHOXlkSE1nUFNCQ2FXNWhjbmxNYjJGa1pYSWdQU0FvWm5WdVkzUnBiMjRvS1NCN1hHNGdJR1oxYm1OMGFXOXVJRUpwYm1GeWVVeHZZV1JsY2lncElIdGNiaUFnSUNCb1lYQndaVzV6S0hSb2FYTXBPMXh1SUNCOVhHNWNiaUFnUW1sdVlYSjVURzloWkdWeUxuQnliM1J2ZEhsd1pTNXNiMkZrSUQwZ1puVnVZM1JwYjI0b1lYTnpaWFFwSUh0Y2JpQWdJQ0IyWVhJZ2RIbHdaU3dnZUdoeU8xeHVJQ0FnSUhob2NpQTlJSFJvYVhNdWNtVnhLQ2s3WEc0Z0lDQWdhV1lnS0NGMGVYQmxLU0I3WEc0Z0lDQWdJQ0IwZVhCbElEMGdYQ0poY25KaGVXSjFabVpsY2x3aU8xeHVJQ0FnSUNBZ2RISjVJSHRjYmlBZ0lDQWdJQ0FnYVdZZ0tFSnNiMkl1Y0hKdmRHOTBlWEJsTG5Oc2FXTmxLU0I3WEc0Z0lDQWdJQ0FnSUNBZ2RIbHdaU0E5SUZ3aVlteHZZbHdpTzF4dUlDQWdJQ0FnSUNCOVhHNGdJQ0FnSUNCOUlHTmhkR05vSUNoZlpYSnliM0lwSUh0OVhHNGdJQ0FnZlZ4dUlDQWdJSGhvY2k1dmNHVnVLRndpUjBWVVhDSXNJR0Z6YzJWMExuTnlZeXdnZEhKMVpTazdYRzRnSUNBZ2VHaHlMbkpsYzNCdmJuTmxWSGx3WlNBOUlIUjVjR1U3WEc0Z0lDQWdlR2h5TG05dWNISnZaM0psYzNNZ1BTQm1kVzVqZEdsdmJpaGxLU0I3ZlR0Y2JpQWdJQ0I0YUhJdWIyNWxjbkp2Y2lBOUlHWjFibU4wYVc5dUtDa2dlMXh1SUNBZ0lDQWdjbVYwZFhKdUlIUm9hWE11WlcxcGRDZ25aWEp5YjNJbkxDQjRhSEl1YzNSaGRIVnpLVHRjYmlBZ0lDQjlPMXh1SUNBZ0lIaG9jaTV2Ym5KbFlXUjVjM1JoZEdWamFHRnVaMlVnUFNBb1puVnVZM1JwYjI0b1gzUm9hWE1wSUh0Y2JpQWdJQ0FnSUhKbGRIVnliaUJtZFc1amRHbHZiaWhsS1NCN1hHNGdJQ0FnSUNBZ0lHbG1JQ2g0YUhJdWNtVmhaSGxUZEdGMFpTQTlQVDBnTkNrZ2UxeHVJQ0FnSUNBZ0lDQWdJR0Z6YzJWMExtUmhkR0VnUFNCNGFISXVjbVZ6Y0c5dWMyVTdYRzRnSUNBZ0lDQWdJQ0FnWDNSb2FYTXVaVzFwZENnbmJHOWhaR1ZrSnl3Z1lYTnpaWFFwTzF4dUlDQWdJQ0FnSUNBZ0lIaG9jaTV2Ym5KbFlXUjVjM1JoZEdWamFHRnVaMlVnUFNCdWRXeHNPMXh1SUNBZ0lDQWdJQ0I5WEc0Z0lDQWdJQ0I5TzF4dUlDQWdJSDBwS0hSb2FYTXBPMXh1SUNBZ0lISmxkSFZ5YmlCNGFISXVjMlZ1WkNodWRXeHNLVHRjYmlBZ2ZUdGNibHh1SUNCQ2FXNWhjbmxNYjJGa1pYSXVjSEp2ZEc5MGVYQmxMbkpsY1NBOUlHWjFibU4wYVc5dUtDa2dlMXh1SUNBZ0lHbG1JQ2gzYVc1a2IzY3VXRTFNU0hSMGNGSmxjWFZsYzNRcElIdGNiaUFnSUNBZ0lISmxkSFZ5YmlCdVpYY2dXRTFNU0hSMGNGSmxjWFZsYzNRb0tUdGNiaUFnSUNCOVhHNGdJQ0FnYVdZZ0tIZHBibVJ2ZHk1QlkzUnBkbVZZVDJKcVpXTjBLU0I3WEc0Z0lDQWdJQ0J5WlhSMWNtNGdibVYzSUVGamRHbDJaVmhQWW1wbFkzUW9YQ0pOVTFoTlRESXVXRTFNU0ZSVVVDNHpMakJjSWlrN1hHNGdJQ0FnZlZ4dUlDQjlPMXh1WEc0Z0lISmxkSFZ5YmlCQ2FXNWhjbmxNYjJGa1pYSTdYRzVjYm4wcEtDazdYRzRpWFgwPSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBEYXRhTG9hZGVyLCBjLCBoYXBwZW5zO1xuXG5oYXBwZW5zID0gcmVxdWlyZSgnaGFwcGVucycpO1xuXG5jID0gcmVxdWlyZSgnLi4vbG9nJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRGF0YUxvYWRlciA9IChmdW5jdGlvbigpIHtcbiAgZnVuY3Rpb24gRGF0YUxvYWRlcigpIHtcbiAgICBoYXBwZW5zKHRoaXMpO1xuICB9XG5cbiAgRGF0YUxvYWRlci5wcm90b3R5cGUubG9hZCA9IGZ1bmN0aW9uKGFzc2V0KSB7XG4gICAgdmFyIHhocjtcbiAgICB4aHIgPSB0aGlzLnJlcSgpO1xuICAgIHhoci5vcGVuKFwiR0VUXCIsIGFzc2V0LnNyYywgdHJ1ZSk7XG4gICAgeGhyLm92ZXJyaWRlTWltZVR5cGUoXCJhcHBsaWNhdGlvbi9qc29uXCIpO1xuICAgIHhoci5vbnByb2dyZXNzID0gZnVuY3Rpb24oZSkge307XG4gICAgeGhyLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiB0aGlzLmVtaXQoJ2Vycm9yJywgeGhyLnN0YXR1cyk7XG4gICAgfTtcbiAgICB4aHIub25yZWFkeXN0YXRlY2hhbmdlID0gKGZ1bmN0aW9uKF90aGlzKSB7XG4gICAgICByZXR1cm4gZnVuY3Rpb24oZSkge1xuICAgICAgICBpZiAoeGhyLnJlYWR5U3RhdGUgPT09IDQpIHtcbiAgICAgICAgICBhc3NldC5kYXRhID0gSlNPTi5wYXJzZSh4aHIucmVzcG9uc2UpO1xuICAgICAgICAgIF90aGlzLmVtaXQoJ2xvYWRlZCcsIGFzc2V0KTtcbiAgICAgICAgICB4aHIub25yZWFkeXN0YXRlY2hhbmdlID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9KSh0aGlzKTtcbiAgICByZXR1cm4geGhyLnNlbmQobnVsbCk7XG4gIH07XG5cbiAgRGF0YUxvYWRlci5wcm90b3R5cGUucmVxID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKHdpbmRvdy5YTUxIdHRwUmVxdWVzdCkge1xuICAgICAgcmV0dXJuIG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuICAgIH1cbiAgICBpZiAod2luZG93LkFjdGl2ZVhPYmplY3QpIHtcbiAgICAgIHJldHVybiBuZXcgQWN0aXZlWE9iamVjdChcIk1TWE1MMi5YTUxIVFRQLjMuMFwiKTtcbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIERhdGFMb2FkZXI7XG5cbn0pKCk7XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKCdfcHJvY2VzcycpLHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWwgOiB0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiL2xvYWRpbmcvZGF0YV9sb2FkZXIuY29mZmVlXCIsXCIvbG9hZGluZ1wiKVxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9ZGF0YTphcHBsaWNhdGlvbi9qc29uO2NoYXJzZXQ6dXRmLTg7YmFzZTY0LGV5SjJaWEp6YVc5dUlqb3pMQ0p6YjNWeVkyVnpJanBiSW14dllXUnBibWN2WkdGMFlWOXNiMkZrWlhJdVkyOW1abVZsSWwwc0ltNWhiV1Z6SWpwYlhTd2liV0Z3Y0dsdVozTWlPaUk3UVVGQlFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEVpTENKbWFXeGxJam9pWjJWdVpYSmhkR1ZrTG1weklpd2ljMjkxY21ObFVtOXZkQ0k2SWlJc0luTnZkWEpqWlhORGIyNTBaVzUwSWpwYkluWmhjaUJFWVhSaFRHOWhaR1Z5TENCakxDQm9ZWEJ3Wlc1ek8xeHVYRzVvWVhCd1pXNXpJRDBnY21WeGRXbHlaU2duYUdGd2NHVnVjeWNwTzF4dVhHNWpJRDBnY21WeGRXbHlaU2duTGk0dmJHOW5KeWs3WEc1Y2JtMXZaSFZzWlM1bGVIQnZjblJ6SUQwZ1JHRjBZVXh2WVdSbGNpQTlJQ2htZFc1amRHbHZiaWdwSUh0Y2JpQWdablZ1WTNScGIyNGdSR0YwWVV4dllXUmxjaWdwSUh0Y2JpQWdJQ0JvWVhCd1pXNXpLSFJvYVhNcE8xeHVJQ0I5WEc1Y2JpQWdSR0YwWVV4dllXUmxjaTV3Y205MGIzUjVjR1V1Ykc5aFpDQTlJR1oxYm1OMGFXOXVLR0Z6YzJWMEtTQjdYRzRnSUNBZ2RtRnlJSGhvY2p0Y2JpQWdJQ0I0YUhJZ1BTQjBhR2x6TG5KbGNTZ3BPMXh1SUNBZ0lIaG9jaTV2Y0dWdUtGd2lSMFZVWENJc0lHRnpjMlYwTG5OeVl5d2dkSEoxWlNrN1hHNGdJQ0FnZUdoeUxtOTJaWEp5YVdSbFRXbHRaVlI1Y0dVb1hDSmhjSEJzYVdOaGRHbHZiaTlxYzI5dVhDSXBPMXh1SUNBZ0lIaG9jaTV2Ym5CeWIyZHlaWE56SUQwZ1puVnVZM1JwYjI0b1pTa2dlMzA3WEc0Z0lDQWdlR2h5TG05dVpYSnliM0lnUFNCbWRXNWpkR2x2YmlncElIdGNiaUFnSUNBZ0lISmxkSFZ5YmlCMGFHbHpMbVZ0YVhRb0oyVnljbTl5Snl3Z2VHaHlMbk4wWVhSMWN5azdYRzRnSUNBZ2ZUdGNiaUFnSUNCNGFISXViMjV5WldGa2VYTjBZWFJsWTJoaGJtZGxJRDBnS0daMWJtTjBhVzl1S0Y5MGFHbHpLU0I3WEc0Z0lDQWdJQ0J5WlhSMWNtNGdablZ1WTNScGIyNG9aU2tnZTF4dUlDQWdJQ0FnSUNCcFppQW9lR2h5TG5KbFlXUjVVM1JoZEdVZ1BUMDlJRFFwSUh0Y2JpQWdJQ0FnSUNBZ0lDQmhjM05sZEM1a1lYUmhJRDBnU2xOUFRpNXdZWEp6WlNoNGFISXVjbVZ6Y0c5dWMyVXBPMXh1SUNBZ0lDQWdJQ0FnSUY5MGFHbHpMbVZ0YVhRb0oyeHZZV1JsWkNjc0lHRnpjMlYwS1R0Y2JpQWdJQ0FnSUNBZ0lDQjRhSEl1YjI1eVpXRmtlWE4wWVhSbFkyaGhibWRsSUQwZ2JuVnNiRHRjYmlBZ0lDQWdJQ0FnZlZ4dUlDQWdJQ0FnZlR0Y2JpQWdJQ0I5S1NoMGFHbHpLVHRjYmlBZ0lDQnlaWFIxY200Z2VHaHlMbk5sYm1Rb2JuVnNiQ2s3WEc0Z0lIMDdYRzVjYmlBZ1JHRjBZVXh2WVdSbGNpNXdjbTkwYjNSNWNHVXVjbVZ4SUQwZ1puVnVZM1JwYjI0b0tTQjdYRzRnSUNBZ2FXWWdLSGRwYm1SdmR5NVlUVXhJZEhSd1VtVnhkV1Z6ZENrZ2UxeHVJQ0FnSUNBZ2NtVjBkWEp1SUc1bGR5QllUVXhJZEhSd1VtVnhkV1Z6ZENncE8xeHVJQ0FnSUgxY2JpQWdJQ0JwWmlBb2QybHVaRzkzTGtGamRHbDJaVmhQWW1wbFkzUXBJSHRjYmlBZ0lDQWdJSEpsZEhWeWJpQnVaWGNnUVdOMGFYWmxXRTlpYW1WamRDaGNJazFUV0UxTU1pNVlUVXhJVkZSUUxqTXVNRndpS1R0Y2JpQWdJQ0I5WEc0Z0lIMDdYRzVjYmlBZ2NtVjBkWEp1SUVSaGRHRk1iMkZrWlhJN1hHNWNibjBwS0NrN1hHNGlYWDA9IiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIEFzeW5jTG9hZGVyLCBCaW5hcnlMb2FkZXIsIERhdGFMb2FkZXIsIFN5bmNMb2FkZXIsIGMsXG4gIGJpbmQgPSBmdW5jdGlvbihmbiwgbWUpeyByZXR1cm4gZnVuY3Rpb24oKXsgcmV0dXJuIGZuLmFwcGx5KG1lLCBhcmd1bWVudHMpOyB9OyB9LFxuICBleHRlbmQgPSBmdW5jdGlvbihjaGlsZCwgcGFyZW50KSB7IGZvciAodmFyIGtleSBpbiBwYXJlbnQpIHsgaWYgKGhhc1Byb3AuY2FsbChwYXJlbnQsIGtleSkpIGNoaWxkW2tleV0gPSBwYXJlbnRba2V5XTsgfSBmdW5jdGlvbiBjdG9yKCkgeyB0aGlzLmNvbnN0cnVjdG9yID0gY2hpbGQ7IH0gY3Rvci5wcm90b3R5cGUgPSBwYXJlbnQucHJvdG90eXBlOyBjaGlsZC5wcm90b3R5cGUgPSBuZXcgY3RvcigpOyBjaGlsZC5fX3N1cGVyX18gPSBwYXJlbnQucHJvdG90eXBlOyByZXR1cm4gY2hpbGQ7IH0sXG4gIGhhc1Byb3AgPSB7fS5oYXNPd25Qcm9wZXJ0eTtcblxuQXN5bmNMb2FkZXIgPSByZXF1aXJlKCcuL2FzeW5jX2xvYWRlcicpO1xuXG5EYXRhTG9hZGVyID0gcmVxdWlyZSgnLi9kYXRhX2xvYWRlcicpO1xuXG5CaW5hcnlMb2FkZXIgPSByZXF1aXJlKCcuL2JpbmFyeV9sb2FkZXInKTtcblxuYyA9IHJlcXVpcmUoJy4uL2xvZycpO1xuXG5cbi8qXG5Mb2FkIGZpbGVzIHN5bmNocm9ub3VzbHlcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN5bmNMb2FkZXIgPSAoZnVuY3Rpb24oc3VwZXJDbGFzcykge1xuICBleHRlbmQoU3luY0xvYWRlciwgc3VwZXJDbGFzcyk7XG5cbiAgZnVuY3Rpb24gU3luY0xvYWRlcigpIHtcbiAgICB0aGlzLnN1Y2Nlc3MgPSBiaW5kKHRoaXMuc3VjY2VzcywgdGhpcyk7XG4gICAgcmV0dXJuIFN5bmNMb2FkZXIuX19zdXBlcl9fLmNvbnN0cnVjdG9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIH1cblxuICBTeW5jTG9hZGVyLnByb3RvdHlwZS5sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5kYXRlID0gbmV3IERhdGUoKTtcbiAgICB0aGlzLmNvdW50ID0gMDtcbiAgICB0aGlzLnRvdGFsID0gdGhpcy5tYW5pZmVzdC5sZW5ndGg7XG4gICAgaWYgKHRoaXMubWFuaWZlc3QubGVuZ3RoIDwgMSkge1xuICAgICAgcmV0dXJuIHRoaXMuZW1pdCgnbG9hZGVkJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0aGlzLl9sb2FkKCk7XG4gICAgfVxuICB9O1xuXG4gIFN5bmNMb2FkZXIucHJvdG90eXBlLl9sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFzc2V0LCBsO1xuICAgIGFzc2V0ID0gdGhpcy5tYW5pZmVzdFt0aGlzLmNvdW50XTtcbiAgICBzd2l0Y2ggKGFzc2V0LnR5cGUpIHtcbiAgICAgIGNhc2UgJ2pzb24nOlxuICAgICAgY2FzZSAneG1sJzpcbiAgICAgICAgbCA9IG5ldyBEYXRhTG9hZGVyO1xuICAgICAgICBsLm9uY2UoJ2xvYWRlZCcsIHRoaXMuc3VjY2Vzcyk7XG4gICAgICAgIHJldHVybiBsLmxvYWQoYXNzZXQpO1xuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgbCA9IG5ldyBCaW5hcnlMb2FkZXI7XG4gICAgICAgIGwub25jZSgnbG9hZGVkJywgdGhpcy5zdWNjZXNzKTtcbiAgICAgICAgcmV0dXJuIGwubG9hZChhc3NldCk7XG4gICAgfVxuICB9O1xuXG4gIFN5bmNMb2FkZXIucHJvdG90eXBlLnN1Y2Nlc3MgPSBmdW5jdGlvbihhc3NldCkge1xuICAgIHRoaXMuY291bnQrKztcbiAgICBpZiAodGhpcy5jb3VudCA+PSB0aGlzLnRvdGFsKSB7XG4gICAgICByZXR1cm4gdGhpcy5lbWl0KCdsb2FkZWQnLCB0aGlzLm1hbmlmZXN0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHRoaXMuX2xvYWQoKTtcbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIFN5bmNMb2FkZXI7XG5cbn0pKEFzeW5jTG9hZGVyKTtcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoJ19wcm9jZXNzJyksdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvbG9hZGluZy9zeW5jX2xvYWRlci5jb2ZmZWVcIixcIi9sb2FkaW5nXCIpXG4vLyMgc291cmNlTWFwcGluZ1VSTD1kYXRhOmFwcGxpY2F0aW9uL2pzb247Y2hhcnNldDp1dGYtODtiYXNlNjQsZXlKMlpYSnphVzl1SWpvekxDSnpiM1Z5WTJWeklqcGJJbXh2WVdScGJtY3ZjM2x1WTE5c2IyRmtaWEl1WTI5bVptVmxJbDBzSW01aGJXVnpJanBiWFN3aWJXRndjR2x1WjNNaU9pSTdRVUZCUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFaUxDSm1hV3hsSWpvaVoyVnVaWEpoZEdWa0xtcHpJaXdpYzI5MWNtTmxVbTl2ZENJNklpSXNJbk52ZFhKalpYTkRiMjUwWlc1MElqcGJJblpoY2lCQmMzbHVZMHh2WVdSbGNpd2dRbWx1WVhKNVRHOWhaR1Z5TENCRVlYUmhURzloWkdWeUxDQlRlVzVqVEc5aFpHVnlMQ0JqTEZ4dUlDQmlhVzVrSUQwZ1puVnVZM1JwYjI0b1ptNHNJRzFsS1hzZ2NtVjBkWEp1SUdaMWJtTjBhVzl1S0NsN0lISmxkSFZ5YmlCbWJpNWhjSEJzZVNodFpTd2dZWEpuZFcxbGJuUnpLVHNnZlRzZ2ZTeGNiaUFnWlhoMFpXNWtJRDBnWm5WdVkzUnBiMjRvWTJocGJHUXNJSEJoY21WdWRDa2dleUJtYjNJZ0tIWmhjaUJyWlhrZ2FXNGdjR0Z5Wlc1MEtTQjdJR2xtSUNob1lYTlFjbTl3TG1OaGJHd29jR0Z5Wlc1MExDQnJaWGtwS1NCamFHbHNaRnRyWlhsZElEMGdjR0Z5Wlc1MFcydGxlVjA3SUgwZ1puVnVZM1JwYjI0Z1kzUnZjaWdwSUhzZ2RHaHBjeTVqYjI1emRISjFZM1J2Y2lBOUlHTm9hV3hrT3lCOUlHTjBiM0l1Y0hKdmRHOTBlWEJsSUQwZ2NHRnlaVzUwTG5CeWIzUnZkSGx3WlRzZ1kyaHBiR1F1Y0hKdmRHOTBlWEJsSUQwZ2JtVjNJR04wYjNJb0tUc2dZMmhwYkdRdVgxOXpkWEJsY2w5ZklEMGdjR0Z5Wlc1MExuQnliM1J2ZEhsd1pUc2djbVYwZFhKdUlHTm9hV3hrT3lCOUxGeHVJQ0JvWVhOUWNtOXdJRDBnZTMwdWFHRnpUM2R1VUhKdmNHVnlkSGs3WEc1Y2JrRnplVzVqVEc5aFpHVnlJRDBnY21WeGRXbHlaU2duTGk5aGMzbHVZMTlzYjJGa1pYSW5LVHRjYmx4dVJHRjBZVXh2WVdSbGNpQTlJSEpsY1hWcGNtVW9KeTR2WkdGMFlWOXNiMkZrWlhJbktUdGNibHh1UW1sdVlYSjVURzloWkdWeUlEMGdjbVZ4ZFdseVpTZ25MaTlpYVc1aGNubGZiRzloWkdWeUp5azdYRzVjYm1NZ1BTQnlaWEYxYVhKbEtDY3VMaTlzYjJjbktUdGNibHh1WEc0dktseHVURzloWkNCbWFXeGxjeUJ6ZVc1amFISnZibTkxYzJ4NVhHNGdLaTljYmx4dWJXOWtkV3hsTG1WNGNHOXlkSE1nUFNCVGVXNWpURzloWkdWeUlEMGdLR1oxYm1OMGFXOXVLSE4xY0dWeVEyeGhjM01wSUh0Y2JpQWdaWGgwWlc1a0tGTjVibU5NYjJGa1pYSXNJSE4xY0dWeVEyeGhjM01wTzF4dVhHNGdJR1oxYm1OMGFXOXVJRk41Ym1OTWIyRmtaWElvS1NCN1hHNGdJQ0FnZEdocGN5NXpkV05qWlhOeklEMGdZbWx1WkNoMGFHbHpMbk4xWTJObGMzTXNJSFJvYVhNcE8xeHVJQ0FnSUhKbGRIVnliaUJUZVc1alRHOWhaR1Z5TGw5ZmMzVndaWEpmWHk1amIyNXpkSEoxWTNSdmNpNWhjSEJzZVNoMGFHbHpMQ0JoY21kMWJXVnVkSE1wTzF4dUlDQjlYRzVjYmlBZ1UzbHVZMHh2WVdSbGNpNXdjbTkwYjNSNWNHVXViRzloWkNBOUlHWjFibU4wYVc5dUtDa2dlMXh1SUNBZ0lIUm9hWE11WkdGMFpTQTlJRzVsZHlCRVlYUmxLQ2s3WEc0Z0lDQWdkR2hwY3k1amIzVnVkQ0E5SURBN1hHNGdJQ0FnZEdocGN5NTBiM1JoYkNBOUlIUm9hWE11YldGdWFXWmxjM1F1YkdWdVozUm9PMXh1SUNBZ0lHbG1JQ2gwYUdsekxtMWhibWxtWlhOMExteGxibWQwYUNBOElERXBJSHRjYmlBZ0lDQWdJSEpsZEhWeWJpQjBhR2x6TG1WdGFYUW9KMnh2WVdSbFpDY3BPMXh1SUNBZ0lIMGdaV3h6WlNCN1hHNGdJQ0FnSUNCeVpYUjFjbTRnZEdocGN5NWZiRzloWkNncE8xeHVJQ0FnSUgxY2JpQWdmVHRjYmx4dUlDQlRlVzVqVEc5aFpHVnlMbkJ5YjNSdmRIbHdaUzVmYkc5aFpDQTlJR1oxYm1OMGFXOXVLQ2tnZTF4dUlDQWdJSFpoY2lCaGMzTmxkQ3dnYkR0Y2JpQWdJQ0JoYzNObGRDQTlJSFJvYVhNdWJXRnVhV1psYzNSYmRHaHBjeTVqYjNWdWRGMDdYRzRnSUNBZ2MzZHBkR05vSUNoaGMzTmxkQzUwZVhCbEtTQjdYRzRnSUNBZ0lDQmpZWE5sSUNkcWMyOXVKenBjYmlBZ0lDQWdJR05oYzJVZ0ozaHRiQ2M2WEc0Z0lDQWdJQ0FnSUd3Z1BTQnVaWGNnUkdGMFlVeHZZV1JsY2p0Y2JpQWdJQ0FnSUNBZ2JDNXZibU5sS0Nkc2IyRmtaV1FuTENCMGFHbHpMbk4xWTJObGMzTXBPMXh1SUNBZ0lDQWdJQ0J5WlhSMWNtNGdiQzVzYjJGa0tHRnpjMlYwS1R0Y2JpQWdJQ0FnSUdOaGMyVWdKMkpwYm1GeWVTYzZYRzRnSUNBZ0lDQWdJR3dnUFNCdVpYY2dRbWx1WVhKNVRHOWhaR1Z5TzF4dUlDQWdJQ0FnSUNCc0xtOXVZMlVvSjJ4dllXUmxaQ2NzSUhSb2FYTXVjM1ZqWTJWemN5azdYRzRnSUNBZ0lDQWdJSEpsZEhWeWJpQnNMbXh2WVdRb1lYTnpaWFFwTzF4dUlDQWdJSDFjYmlBZ2ZUdGNibHh1SUNCVGVXNWpURzloWkdWeUxuQnliM1J2ZEhsd1pTNXpkV05qWlhOeklEMGdablZ1WTNScGIyNG9ZWE56WlhRcElIdGNiaUFnSUNCMGFHbHpMbU52ZFc1MEt5czdYRzRnSUNBZ2FXWWdLSFJvYVhNdVkyOTFiblFnUGowZ2RHaHBjeTUwYjNSaGJDa2dlMXh1SUNBZ0lDQWdjbVYwZFhKdUlIUm9hWE11WlcxcGRDZ25iRzloWkdWa0p5d2dkR2hwY3k1dFlXNXBabVZ6ZENrN1hHNGdJQ0FnZlNCbGJITmxJSHRjYmlBZ0lDQWdJSEpsZEhWeWJpQjBhR2x6TGw5c2IyRmtLQ2s3WEc0Z0lDQWdmVnh1SUNCOU8xeHVYRzRnSUhKbGRIVnliaUJUZVc1alRHOWhaR1Z5TzF4dVhHNTlLU2hCYzNsdVkweHZZV1JsY2lrN1hHNGlYWDA9IiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIGxvZyxcbiAgc2xpY2UgPSBbXS5zbGljZTtcblxubG9nID0ge307XG5cbmxvZy5lbmFibGUgPSBmYWxzZTtcblxubG9nLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGlmICgodHlwZW9mIGNvbnNvbGUgIT09IFwidW5kZWZpbmVkXCIgJiYgY29uc29sZSAhPT0gbnVsbCkgJiYgKGNvbnNvbGUuY2xlYXIgIT0gbnVsbCkpIHtcbiAgICByZXR1cm4gY29uc29sZS5jbGVhcigpO1xuICB9XG59O1xuXG5sb2cubG9nID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmdzO1xuICBhcmdzID0gMSA8PSBhcmd1bWVudHMubGVuZ3RoID8gc2xpY2UuY2FsbChhcmd1bWVudHMsIDApIDogW107XG4gIGlmICh0aGlzLmVuYWJsZSkge1xuICAgIGlmICgodHlwZW9mIGNvbnNvbGUgIT09IFwidW5kZWZpbmVkXCIgJiYgY29uc29sZSAhPT0gbnVsbCkgJiYgKGNvbnNvbGUubG9nICE9IG51bGwpICYmIChjb25zb2xlLmxvZy5hcHBseSAhPSBudWxsKSkge1xuICAgICAgcmV0dXJuIGNvbnNvbGUubG9nLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gY29uc29sZS5sb2coYXJncyk7XG4gICAgfVxuICB9XG59O1xuXG5sb2cuZGVidWcgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGFyZ3M7XG4gIGFyZ3MgPSAxIDw9IGFyZ3VtZW50cy5sZW5ndGggPyBzbGljZS5jYWxsKGFyZ3VtZW50cywgMCkgOiBbXTtcbiAgaWYgKHRoaXMuZW5hYmxlKSB7XG4gICAgaWYgKCh0eXBlb2YgY29uc29sZSAhPT0gXCJ1bmRlZmluZWRcIiAmJiBjb25zb2xlICE9PSBudWxsKSAmJiAoY29uc29sZS5kZWJ1ZyAhPSBudWxsKSAmJiAoY29uc29sZS5kZWJ1Zy5hcHBseSAhPSBudWxsKSkge1xuICAgICAgcmV0dXJuIGNvbnNvbGUuZGVidWcuYXBwbHkoY29uc29sZSwgYXJncyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBjb25zb2xlLmxvZyhhcmdzKTtcbiAgICB9XG4gIH1cbn07XG5cbmxvZy5pbmZvID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmdzO1xuICBhcmdzID0gMSA8PSBhcmd1bWVudHMubGVuZ3RoID8gc2xpY2UuY2FsbChhcmd1bWVudHMsIDApIDogW107XG4gIGlmICh0aGlzLmVuYWJsZSkge1xuICAgIGlmICgodHlwZW9mIGNvbnNvbGUgIT09IFwidW5kZWZpbmVkXCIgJiYgY29uc29sZSAhPT0gbnVsbCkgJiYgKGNvbnNvbGUuaW5mbyAhPSBudWxsKSAmJiAoY29uc29sZS5pbmZvLmFwcGx5ICE9IG51bGwpKSB7XG4gICAgICByZXR1cm4gY29uc29sZS5pbmZvLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gY29uc29sZS5sb2coYXJncyk7XG4gICAgfVxuICB9XG59O1xuXG5sb2cud2FybiA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYXJncztcbiAgYXJncyA9IDEgPD0gYXJndW1lbnRzLmxlbmd0aCA/IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAwKSA6IFtdO1xuICBpZiAodGhpcy5lbmFibGUpIHtcbiAgICBpZiAoKHR5cGVvZiBjb25zb2xlICE9PSBcInVuZGVmaW5lZFwiICYmIGNvbnNvbGUgIT09IG51bGwpICYmIChjb25zb2xlLndhcm4gIT0gbnVsbCkgJiYgKGNvbnNvbGUud2Fybi5hcHBseSAhPSBudWxsKSkge1xuICAgICAgcmV0dXJuIGNvbnNvbGUud2Fybi5hcHBseShjb25zb2xlLCBhcmdzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGNvbnNvbGUubG9nKGFyZ3MpO1xuICAgIH1cbiAgfVxufTtcblxubG9nLmVycm9yID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmdzO1xuICBhcmdzID0gMSA8PSBhcmd1bWVudHMubGVuZ3RoID8gc2xpY2UuY2FsbChhcmd1bWVudHMsIDApIDogW107XG4gIGlmICh0aGlzLmVuYWJsZSkge1xuICAgIGlmICgodHlwZW9mIGNvbnNvbGUgIT09IFwidW5kZWZpbmVkXCIgJiYgY29uc29sZSAhPT0gbnVsbCkgJiYgKGNvbnNvbGUuZXJyb3IgIT0gbnVsbCkgJiYgKGNvbnNvbGUuZXJyb3IuYXBwbHkgIT0gbnVsbCkpIHtcbiAgICAgIHJldHVybiBjb25zb2xlLmVycm9yLmFwcGx5KGNvbnNvbGUsIGFyZ3MpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gY29uc29sZS5sb2coYXJncyk7XG4gICAgfVxuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGxvZztcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoJ19wcm9jZXNzJyksdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvbG9nLmNvZmZlZVwiLFwiL1wiKVxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9ZGF0YTphcHBsaWNhdGlvbi9qc29uO2NoYXJzZXQ6dXRmLTg7YmFzZTY0LGV5SjJaWEp6YVc5dUlqb3pMQ0p6YjNWeVkyVnpJanBiSW14dlp5NWpiMlptWldVaVhTd2libUZ0WlhNaU9sdGRMQ0p0WVhCd2FXNW5jeUk2SWp0QlFVRkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRU0lzSW1acGJHVWlPaUpuWlc1bGNtRjBaV1F1YW5NaUxDSnpiM1Z5WTJWU2IyOTBJam9pSWl3aWMyOTFjbU5sYzBOdmJuUmxiblFpT2xzaWRtRnlJR3h2Wnl4Y2JpQWdjMnhwWTJVZ1BTQmJYUzV6YkdsalpUdGNibHh1Ykc5bklEMGdlMzA3WEc1Y2JteHZaeTVsYm1GaWJHVWdQU0JtWVd4elpUdGNibHh1Ykc5bkxtTnNaV0Z5SUQwZ1puVnVZM1JwYjI0b0tTQjdYRzRnSUdsbUlDZ29kSGx3Wlc5bUlHTnZibk52YkdVZ0lUMDlJRndpZFc1a1pXWnBibVZrWENJZ0ppWWdZMjl1YzI5c1pTQWhQVDBnYm5Wc2JDa2dKaVlnS0dOdmJuTnZiR1V1WTJ4bFlYSWdJVDBnYm5Wc2JDa3BJSHRjYmlBZ0lDQnlaWFIxY200Z1kyOXVjMjlzWlM1amJHVmhjaWdwTzF4dUlDQjlYRzU5TzF4dVhHNXNiMmN1Ykc5bklEMGdablZ1WTNScGIyNG9LU0I3WEc0Z0lIWmhjaUJoY21kek8xeHVJQ0JoY21keklEMGdNU0E4UFNCaGNtZDFiV1Z1ZEhNdWJHVnVaM1JvSUQ4Z2MyeHBZMlV1WTJGc2JDaGhjbWQxYldWdWRITXNJREFwSURvZ1cxMDdYRzRnSUdsbUlDaDBhR2x6TG1WdVlXSnNaU2tnZTF4dUlDQWdJR2xtSUNnb2RIbHdaVzltSUdOdmJuTnZiR1VnSVQwOUlGd2lkVzVrWldacGJtVmtYQ0lnSmlZZ1kyOXVjMjlzWlNBaFBUMGdiblZzYkNrZ0ppWWdLR052Ym5OdmJHVXViRzluSUNFOUlHNTFiR3dwSUNZbUlDaGpiMjV6YjJ4bExteHZaeTVoY0hCc2VTQWhQU0J1ZFd4c0tTa2dlMXh1SUNBZ0lDQWdjbVYwZFhKdUlHTnZibk52YkdVdWJHOW5MbUZ3Y0d4NUtHTnZibk52YkdVc0lHRnlaM01wTzF4dUlDQWdJSDBnWld4elpTQjdYRzRnSUNBZ0lDQnlaWFIxY200Z1kyOXVjMjlzWlM1c2IyY29ZWEpuY3lrN1hHNGdJQ0FnZlZ4dUlDQjlYRzU5TzF4dVhHNXNiMmN1WkdWaWRXY2dQU0JtZFc1amRHbHZiaWdwSUh0Y2JpQWdkbUZ5SUdGeVozTTdYRzRnSUdGeVozTWdQU0F4SUR3OUlHRnlaM1Z0Wlc1MGN5NXNaVzVuZEdnZ1B5QnpiR2xqWlM1allXeHNLR0Z5WjNWdFpXNTBjeXdnTUNrZ09pQmJYVHRjYmlBZ2FXWWdLSFJvYVhNdVpXNWhZbXhsS1NCN1hHNGdJQ0FnYVdZZ0tDaDBlWEJsYjJZZ1kyOXVjMjlzWlNBaFBUMGdYQ0oxYm1SbFptbHVaV1JjSWlBbUppQmpiMjV6YjJ4bElDRTlQU0J1ZFd4c0tTQW1KaUFvWTI5dWMyOXNaUzVrWldKMVp5QWhQU0J1ZFd4c0tTQW1KaUFvWTI5dWMyOXNaUzVrWldKMVp5NWhjSEJzZVNBaFBTQnVkV3hzS1NrZ2UxeHVJQ0FnSUNBZ2NtVjBkWEp1SUdOdmJuTnZiR1V1WkdWaWRXY3VZWEJ3Ykhrb1kyOXVjMjlzWlN3Z1lYSm5jeWs3WEc0Z0lDQWdmU0JsYkhObElIdGNiaUFnSUNBZ0lISmxkSFZ5YmlCamIyNXpiMnhsTG14dlp5aGhjbWR6S1R0Y2JpQWdJQ0I5WEc0Z0lIMWNibjA3WEc1Y2JteHZaeTVwYm1adklEMGdablZ1WTNScGIyNG9LU0I3WEc0Z0lIWmhjaUJoY21kek8xeHVJQ0JoY21keklEMGdNU0E4UFNCaGNtZDFiV1Z1ZEhNdWJHVnVaM1JvSUQ4Z2MyeHBZMlV1WTJGc2JDaGhjbWQxYldWdWRITXNJREFwSURvZ1cxMDdYRzRnSUdsbUlDaDBhR2x6TG1WdVlXSnNaU2tnZTF4dUlDQWdJR2xtSUNnb2RIbHdaVzltSUdOdmJuTnZiR1VnSVQwOUlGd2lkVzVrWldacGJtVmtYQ0lnSmlZZ1kyOXVjMjlzWlNBaFBUMGdiblZzYkNrZ0ppWWdLR052Ym5OdmJHVXVhVzVtYnlBaFBTQnVkV3hzS1NBbUppQW9ZMjl1YzI5c1pTNXBibVp2TG1Gd2NHeDVJQ0U5SUc1MWJHd3BLU0I3WEc0Z0lDQWdJQ0J5WlhSMWNtNGdZMjl1YzI5c1pTNXBibVp2TG1Gd2NHeDVLR052Ym5OdmJHVXNJR0Z5WjNNcE8xeHVJQ0FnSUgwZ1pXeHpaU0I3WEc0Z0lDQWdJQ0J5WlhSMWNtNGdZMjl1YzI5c1pTNXNiMmNvWVhKbmN5azdYRzRnSUNBZ2ZWeHVJQ0I5WEc1OU8xeHVYRzVzYjJjdWQyRnliaUE5SUdaMWJtTjBhVzl1S0NrZ2UxeHVJQ0IyWVhJZ1lYSm5jenRjYmlBZ1lYSm5jeUE5SURFZ1BEMGdZWEpuZFcxbGJuUnpMbXhsYm1kMGFDQS9JSE5zYVdObExtTmhiR3dvWVhKbmRXMWxiblJ6TENBd0tTQTZJRnRkTzF4dUlDQnBaaUFvZEdocGN5NWxibUZpYkdVcElIdGNiaUFnSUNCcFppQW9LSFI1Y0dWdlppQmpiMjV6YjJ4bElDRTlQU0JjSW5WdVpHVm1hVzVsWkZ3aUlDWW1JR052Ym5OdmJHVWdJVDA5SUc1MWJHd3BJQ1ltSUNoamIyNXpiMnhsTG5kaGNtNGdJVDBnYm5Wc2JDa2dKaVlnS0dOdmJuTnZiR1V1ZDJGeWJpNWhjSEJzZVNBaFBTQnVkV3hzS1NrZ2UxeHVJQ0FnSUNBZ2NtVjBkWEp1SUdOdmJuTnZiR1V1ZDJGeWJpNWhjSEJzZVNoamIyNXpiMnhsTENCaGNtZHpLVHRjYmlBZ0lDQjlJR1ZzYzJVZ2UxeHVJQ0FnSUNBZ2NtVjBkWEp1SUdOdmJuTnZiR1V1Ykc5bktHRnlaM01wTzF4dUlDQWdJSDFjYmlBZ2ZWeHVmVHRjYmx4dWJHOW5MbVZ5Y205eUlEMGdablZ1WTNScGIyNG9LU0I3WEc0Z0lIWmhjaUJoY21kek8xeHVJQ0JoY21keklEMGdNU0E4UFNCaGNtZDFiV1Z1ZEhNdWJHVnVaM1JvSUQ4Z2MyeHBZMlV1WTJGc2JDaGhjbWQxYldWdWRITXNJREFwSURvZ1cxMDdYRzRnSUdsbUlDaDBhR2x6TG1WdVlXSnNaU2tnZTF4dUlDQWdJR2xtSUNnb2RIbHdaVzltSUdOdmJuTnZiR1VnSVQwOUlGd2lkVzVrWldacGJtVmtYQ0lnSmlZZ1kyOXVjMjlzWlNBaFBUMGdiblZzYkNrZ0ppWWdLR052Ym5OdmJHVXVaWEp5YjNJZ0lUMGdiblZzYkNrZ0ppWWdLR052Ym5OdmJHVXVaWEp5YjNJdVlYQndiSGtnSVQwZ2JuVnNiQ2twSUh0Y2JpQWdJQ0FnSUhKbGRIVnliaUJqYjI1emIyeGxMbVZ5Y205eUxtRndjR3g1S0dOdmJuTnZiR1VzSUdGeVozTXBPMXh1SUNBZ0lIMGdaV3h6WlNCN1hHNGdJQ0FnSUNCeVpYUjFjbTRnWTI5dWMyOXNaUzVzYjJjb1lYSm5jeWs3WEc0Z0lDQWdmVnh1SUNCOVhHNTlPMXh1WEc1dGIyUjFiR1V1Wlhod2IzSjBjeUE5SUd4dlp6dGNiaUpkZlE9PSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBjLCBoYXBwZW5zO1xuXG5oYXBwZW5zID0gcmVxdWlyZSgnaGFwcGVucycpO1xuXG5jID0gcmVxdWlyZSgnLi9sb2cnKTtcblxuZXhwb3J0cy5QbGF5YmFja01vZGUgPSAoZnVuY3Rpb24oKSB7XG4gIF9DbGFzcy5wcm90b3R5cGUucGxheWluZyA9IGZhbHNlO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUucGF1c2VkID0gZmFsc2U7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5mcmFtZSA9IDA7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS50b3RhbF9mcmFtZXMgPSAwO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUuZHVyYXRpb24gPSAxO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUucGVyY2VudCA9IDA7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5sb29wID0gZmFsc2U7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5zdGF0dXMgPSAnJztcblxuICBmdW5jdGlvbiBfQ2xhc3MoKSB7XG4gICAgaGFwcGVucyh0aGlzKTtcbiAgfVxuXG4gIF9DbGFzcy5wcm90b3R5cGUucGxheSA9IGZ1bmN0aW9uKGR1cmF0aW9uKSB7XG4gICAgdmFyIHBhcmFtcztcbiAgICB0aGlzLmR1cmF0aW9uID0gZHVyYXRpb247XG4gICAgcGFyYW1zID0ge1xuICAgICAgZnJhbWU6IHRoaXMudG90YWxfZnJhbWVzLFxuICAgICAgZWFzZTogTGluZWFyLmVhc2VOb25lLFxuICAgICAgb25TdGFydDogKGZ1bmN0aW9uKF90aGlzKSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBfdGhpcy5wbGF5aW5nID0gdHJ1ZTtcbiAgICAgICAgICBfdGhpcy5zdGF0dXMgPSAncGxheWluZyc7XG4gICAgICAgICAgcmV0dXJuIF90aGlzLmVtaXQoJ3N0YXJ0Jyk7XG4gICAgICAgIH07XG4gICAgICB9KSh0aGlzKSxcbiAgICAgIG9uVXBkYXRlOiAoZnVuY3Rpb24oX3RoaXMpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIF90aGlzLnBlcmNlbnQgPSBfdGhpcy5mcmFtZSAvIF90aGlzLnRvdGFsX2ZyYW1lcztcbiAgICAgICAgICByZXR1cm4gX3RoaXMuZW1pdCgndXBkYXRlJyk7XG4gICAgICAgIH07XG4gICAgICB9KSh0aGlzKSxcbiAgICAgIG9uQ29tcGxldGU6IChmdW5jdGlvbihfdGhpcykge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgX3RoaXMuZnJhbWUgPSAwO1xuICAgICAgICAgIGlmIChfdGhpcy5sb29wKSB7XG4gICAgICAgICAgICByZXR1cm4gX3RoaXMucGxheShfdGhpcy5kdXJhdGlvbik7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBfdGhpcy5zdG9wKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgfSkodGhpcylcbiAgICB9O1xuICAgIHJldHVybiB0aGlzLnR3ZWVuID0gVHdlZW5MaXRlLnRvKHRoaXMsIHRoaXMuZHVyYXRpb24sIHBhcmFtcyk7XG4gIH07XG5cblxuICAvKlxuICBcdFBhdXNlIHRoZSBwbGF5YmFja1xuICAgKi9cblxuICBfQ2xhc3MucHJvdG90eXBlLnBhdXNlID0gZnVuY3Rpb24oKSB7XG4gICAgYy5kZWJ1ZygncGF1c2VkJyk7XG4gICAgdGhpcy5zdGF0dXMgPSAnYnVmZmVyaW5nJztcbiAgICB0aGlzLnBhdXNlZCA9IHRydWU7XG4gICAgdGhpcy50d2Vlbi5wYXVzZSgpO1xuICAgIHJldHVybiB0aGlzLmVtaXQoJ3BhdXNlJyk7XG4gIH07XG5cblxuICAvKlxuICBcdFBhdXNlIHRoZSBwbGF5YmFja1xuICAgKi9cblxuICBfQ2xhc3MucHJvdG90eXBlLnJlc3VtZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZWY7XG4gICAgaWYgKCF0aGlzLnBsYXlpbmcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMucGF1c2VkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc3RhdHVzID0gJ3BsYXlpbmcnO1xuICAgIHRoaXMucGF1c2VkID0gZmFsc2U7XG4gICAgaWYgKChyZWYgPSB0aGlzLnR3ZWVuKSAhPSBudWxsKSB7XG4gICAgICByZWYucGxheSgpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5lbWl0KCdyZXN1bWUnKTtcbiAgfTtcblxuICBfQ2xhc3MucHJvdG90eXBlLnN0b3AgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnBsYXlpbmcgPSBmYWxzZTtcbiAgICB0aGlzLnN0YXR1cyA9ICdzdG9wcGVkJztcbiAgICByZXR1cm4gdGhpcy5lbWl0KCdzdG9wJyk7XG4gIH07XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5nZXRfZnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZnJhbWU7XG4gICAgZnJhbWUgPSBNYXRoLmZsb29yKHRoaXMuZnJhbWUpO1xuICAgIGZyYW1lID0gTWF0aC5taW4oZnJhbWUsIHRoaXMudG90YWxfZnJhbWVzKTtcbiAgICBmcmFtZSA9IE1hdGgubWF4KGZyYW1lLCAwKTtcbiAgICByZXR1cm4gZnJhbWU7XG4gIH07XG5cbiAgcmV0dXJuIF9DbGFzcztcblxufSkoKTtcblxuZXhwb3J0cy5GcmFtZU1vZGUgPSAoZnVuY3Rpb24oKSB7XG4gIF9DbGFzcy5wcm90b3R5cGUucGxheWluZyA9IGZhbHNlO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUucGF1c2VkID0gZmFsc2U7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5mcmFtZSA9IDA7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS50b3RhbF9mcmFtZXMgPSAwO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUuZHVyYXRpb24gPSAxO1xuXG4gIF9DbGFzcy5wcm90b3R5cGUucGVyY2VudCA9IDA7XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5zdGF0dXMgPSAnJztcblxuICBmdW5jdGlvbiBfQ2xhc3MoKSB7XG4gICAgaGFwcGVucyh0aGlzKTtcbiAgfVxuXG4gIF9DbGFzcy5wcm90b3R5cGUuc2V0X2ZyYW1lID0gZnVuY3Rpb24oZnJhbWUxKSB7XG4gICAgdGhpcy5mcmFtZSA9IGZyYW1lMTtcbiAgICByZXR1cm4gdGhpcy5wZXJjZW50ID0gdGhpcy5mcmFtZSAvIHRoaXMudG90YWxfZnJhbWVzO1xuICB9O1xuXG4gIF9DbGFzcy5wcm90b3R5cGUuZ2V0X2ZyYW1lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZnJhbWU7XG4gIH07XG5cbiAgX0NsYXNzLnByb3RvdHlwZS5nZXRfZnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZnJhbWU7XG4gICAgZnJhbWUgPSBNYXRoLmZsb29yKHRoaXMuZnJhbWUpO1xuICAgIGZyYW1lID0gTWF0aC5taW4oZnJhbWUsIHRoaXMudG90YWxfZnJhbWVzKTtcbiAgICByZXR1cm4gZnJhbWUgPSBNYXRoLm1heChmcmFtZSwgMCk7XG4gIH07XG5cbiAgcmV0dXJuIF9DbGFzcztcblxufSkoKTtcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoJ19wcm9jZXNzJyksdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvbW9kZXMuY29mZmVlXCIsXCIvXCIpXG4vLyMgc291cmNlTWFwcGluZ1VSTD1kYXRhOmFwcGxpY2F0aW9uL2pzb247Y2hhcnNldDp1dGYtODtiYXNlNjQsZXlKMlpYSnphVzl1SWpvekxDSnpiM1Z5WTJWeklqcGJJbTF2WkdWekxtTnZabVpsWlNKZExDSnVZVzFsY3lJNlcxMHNJbTFoY0hCcGJtZHpJam9pTzBGQlFVRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEVpTENKbWFXeGxJam9pWjJWdVpYSmhkR1ZrTG1weklpd2ljMjkxY21ObFVtOXZkQ0k2SWlJc0luTnZkWEpqWlhORGIyNTBaVzUwSWpwYkluWmhjaUJqTENCb1lYQndaVzV6TzF4dVhHNW9ZWEJ3Wlc1eklEMGdjbVZ4ZFdseVpTZ25hR0Z3Y0dWdWN5Y3BPMXh1WEc1aklEMGdjbVZ4ZFdseVpTZ25MaTlzYjJjbktUdGNibHh1Wlhod2IzSjBjeTVRYkdGNVltRmphMDF2WkdVZ1BTQW9ablZ1WTNScGIyNG9LU0I3WEc0Z0lGOURiR0Z6Y3k1d2NtOTBiM1I1Y0dVdWNHeGhlV2x1WnlBOUlHWmhiSE5sTzF4dVhHNGdJRjlEYkdGemN5NXdjbTkwYjNSNWNHVXVjR0YxYzJWa0lEMGdabUZzYzJVN1hHNWNiaUFnWDBOc1lYTnpMbkJ5YjNSdmRIbHdaUzVtY21GdFpTQTlJREE3WEc1Y2JpQWdYME5zWVhOekxuQnliM1J2ZEhsd1pTNTBiM1JoYkY5bWNtRnRaWE1nUFNBd08xeHVYRzRnSUY5RGJHRnpjeTV3Y205MGIzUjVjR1V1WkhWeVlYUnBiMjRnUFNBeE8xeHVYRzRnSUY5RGJHRnpjeTV3Y205MGIzUjVjR1V1Y0dWeVkyVnVkQ0E5SURBN1hHNWNiaUFnWDBOc1lYTnpMbkJ5YjNSdmRIbHdaUzVzYjI5d0lEMGdabUZzYzJVN1hHNWNiaUFnWDBOc1lYTnpMbkJ5YjNSdmRIbHdaUzV6ZEdGMGRYTWdQU0FuSnp0Y2JseHVJQ0JtZFc1amRHbHZiaUJmUTJ4aGMzTW9LU0I3WEc0Z0lDQWdhR0Z3Y0dWdWN5aDBhR2x6S1R0Y2JpQWdmVnh1WEc0Z0lGOURiR0Z6Y3k1d2NtOTBiM1I1Y0dVdWNHeGhlU0E5SUdaMWJtTjBhVzl1S0dSMWNtRjBhVzl1S1NCN1hHNGdJQ0FnZG1GeUlIQmhjbUZ0Y3p0Y2JpQWdJQ0IwYUdsekxtUjFjbUYwYVc5dUlEMGdaSFZ5WVhScGIyNDdYRzRnSUNBZ2NHRnlZVzF6SUQwZ2UxeHVJQ0FnSUNBZ1puSmhiV1U2SUhSb2FYTXVkRzkwWVd4ZlpuSmhiV1Z6TEZ4dUlDQWdJQ0FnWldGelpUb2dUR2x1WldGeUxtVmhjMlZPYjI1bExGeHVJQ0FnSUNBZ2IyNVRkR0Z5ZERvZ0tHWjFibU4wYVc5dUtGOTBhR2x6S1NCN1hHNGdJQ0FnSUNBZ0lISmxkSFZ5YmlCbWRXNWpkR2x2YmlncElIdGNiaUFnSUNBZ0lDQWdJQ0JmZEdocGN5NXdiR0Y1YVc1bklEMGdkSEoxWlR0Y2JpQWdJQ0FnSUNBZ0lDQmZkR2hwY3k1emRHRjBkWE1nUFNBbmNHeGhlV2x1WnljN1hHNGdJQ0FnSUNBZ0lDQWdjbVYwZFhKdUlGOTBhR2x6TG1WdGFYUW9KM04wWVhKMEp5azdYRzRnSUNBZ0lDQWdJSDA3WEc0Z0lDQWdJQ0I5S1NoMGFHbHpLU3hjYmlBZ0lDQWdJRzl1VlhCa1lYUmxPaUFvWm5WdVkzUnBiMjRvWDNSb2FYTXBJSHRjYmlBZ0lDQWdJQ0FnY21WMGRYSnVJR1oxYm1OMGFXOXVLQ2tnZTF4dUlDQWdJQ0FnSUNBZ0lGOTBhR2x6TG5CbGNtTmxiblFnUFNCZmRHaHBjeTVtY21GdFpTQXZJRjkwYUdsekxuUnZkR0ZzWDJaeVlXMWxjenRjYmlBZ0lDQWdJQ0FnSUNCeVpYUjFjbTRnWDNSb2FYTXVaVzFwZENnbmRYQmtZWFJsSnlrN1hHNGdJQ0FnSUNBZ0lIMDdYRzRnSUNBZ0lDQjlLU2gwYUdsektTeGNiaUFnSUNBZ0lHOXVRMjl0Y0d4bGRHVTZJQ2htZFc1amRHbHZiaWhmZEdocGN5a2dlMXh1SUNBZ0lDQWdJQ0J5WlhSMWNtNGdablZ1WTNScGIyNG9LU0I3WEc0Z0lDQWdJQ0FnSUNBZ1gzUm9hWE11Wm5KaGJXVWdQU0F3TzF4dUlDQWdJQ0FnSUNBZ0lHbG1JQ2hmZEdocGN5NXNiMjl3S1NCN1hHNGdJQ0FnSUNBZ0lDQWdJQ0J5WlhSMWNtNGdYM1JvYVhNdWNHeGhlU2hmZEdocGN5NWtkWEpoZEdsdmJpazdYRzRnSUNBZ0lDQWdJQ0FnZlNCbGJITmxJSHRjYmlBZ0lDQWdJQ0FnSUNBZ0lISmxkSFZ5YmlCZmRHaHBjeTV6ZEc5d0tDazdYRzRnSUNBZ0lDQWdJQ0FnZlZ4dUlDQWdJQ0FnSUNCOU8xeHVJQ0FnSUNBZ2ZTa29kR2hwY3lsY2JpQWdJQ0I5TzF4dUlDQWdJSEpsZEhWeWJpQjBhR2x6TG5SM1pXVnVJRDBnVkhkbFpXNU1hWFJsTG5SdktIUm9hWE1zSUhSb2FYTXVaSFZ5WVhScGIyNHNJSEJoY21GdGN5azdYRzRnSUgwN1hHNWNibHh1SUNBdktseHVJQ0JjZEZCaGRYTmxJSFJvWlNCd2JHRjVZbUZqYTF4dUlDQWdLaTljYmx4dUlDQmZRMnhoYzNNdWNISnZkRzkwZVhCbExuQmhkWE5sSUQwZ1puVnVZM1JwYjI0b0tTQjdYRzRnSUNBZ1l5NWtaV0oxWnlnbmNHRjFjMlZrSnlrN1hHNGdJQ0FnZEdocGN5NXpkR0YwZFhNZ1BTQW5ZblZtWm1WeWFXNW5KenRjYmlBZ0lDQjBhR2x6TG5CaGRYTmxaQ0E5SUhSeWRXVTdYRzRnSUNBZ2RHaHBjeTUwZDJWbGJpNXdZWFZ6WlNncE8xeHVJQ0FnSUhKbGRIVnliaUIwYUdsekxtVnRhWFFvSjNCaGRYTmxKeWs3WEc0Z0lIMDdYRzVjYmx4dUlDQXZLbHh1SUNCY2RGQmhkWE5sSUhSb1pTQndiR0Y1WW1GamExeHVJQ0FnS2k5Y2JseHVJQ0JmUTJ4aGMzTXVjSEp2ZEc5MGVYQmxMbkpsYzNWdFpTQTlJR1oxYm1OMGFXOXVLQ2tnZTF4dUlDQWdJSFpoY2lCeVpXWTdYRzRnSUNBZ2FXWWdLQ0YwYUdsekxuQnNZWGxwYm1jcElIdGNiaUFnSUNBZ0lISmxkSFZ5Ymp0Y2JpQWdJQ0I5WEc0Z0lDQWdhV1lnS0hSb2FYTXVjR0YxYzJWa0tTQjdYRzRnSUNBZ0lDQnlaWFIxY200N1hHNGdJQ0FnZlZ4dUlDQWdJSFJvYVhNdWMzUmhkSFZ6SUQwZ0ozQnNZWGxwYm1jbk8xeHVJQ0FnSUhSb2FYTXVjR0YxYzJWa0lEMGdabUZzYzJVN1hHNGdJQ0FnYVdZZ0tDaHlaV1lnUFNCMGFHbHpMblIzWldWdUtTQWhQU0J1ZFd4c0tTQjdYRzRnSUNBZ0lDQnlaV1l1Y0d4aGVTZ3BPMXh1SUNBZ0lIMWNiaUFnSUNCeVpYUjFjbTRnZEdocGN5NWxiV2wwS0NkeVpYTjFiV1VuS1R0Y2JpQWdmVHRjYmx4dUlDQmZRMnhoYzNNdWNISnZkRzkwZVhCbExuTjBiM0FnUFNCbWRXNWpkR2x2YmlncElIdGNiaUFnSUNCMGFHbHpMbkJzWVhscGJtY2dQU0JtWVd4elpUdGNiaUFnSUNCMGFHbHpMbk4wWVhSMWN5QTlJQ2R6ZEc5d2NHVmtKenRjYmlBZ0lDQnlaWFIxY200Z2RHaHBjeTVsYldsMEtDZHpkRzl3SnlrN1hHNGdJSDA3WEc1Y2JpQWdYME5zWVhOekxuQnliM1J2ZEhsd1pTNW5aWFJmWm5KaGJXVWdQU0JtZFc1amRHbHZiaWdwSUh0Y2JpQWdJQ0IyWVhJZ1puSmhiV1U3WEc0Z0lDQWdabkpoYldVZ1BTQk5ZWFJvTG1ac2IyOXlLSFJvYVhNdVpuSmhiV1VwTzF4dUlDQWdJR1p5WVcxbElEMGdUV0YwYUM1dGFXNG9abkpoYldVc0lIUm9hWE11ZEc5MFlXeGZabkpoYldWektUdGNiaUFnSUNCbWNtRnRaU0E5SUUxaGRHZ3ViV0Y0S0daeVlXMWxMQ0F3S1R0Y2JpQWdJQ0J5WlhSMWNtNGdabkpoYldVN1hHNGdJSDA3WEc1Y2JpQWdjbVYwZFhKdUlGOURiR0Z6Y3p0Y2JseHVmU2tvS1R0Y2JseHVaWGh3YjNKMGN5NUdjbUZ0WlUxdlpHVWdQU0FvWm5WdVkzUnBiMjRvS1NCN1hHNGdJRjlEYkdGemN5NXdjbTkwYjNSNWNHVXVjR3hoZVdsdVp5QTlJR1poYkhObE8xeHVYRzRnSUY5RGJHRnpjeTV3Y205MGIzUjVjR1V1Y0dGMWMyVmtJRDBnWm1Gc2MyVTdYRzVjYmlBZ1gwTnNZWE56TG5CeWIzUnZkSGx3WlM1bWNtRnRaU0E5SURBN1hHNWNiaUFnWDBOc1lYTnpMbkJ5YjNSdmRIbHdaUzUwYjNSaGJGOW1jbUZ0WlhNZ1BTQXdPMXh1WEc0Z0lGOURiR0Z6Y3k1d2NtOTBiM1I1Y0dVdVpIVnlZWFJwYjI0Z1BTQXhPMXh1WEc0Z0lGOURiR0Z6Y3k1d2NtOTBiM1I1Y0dVdWNHVnlZMlZ1ZENBOUlEQTdYRzVjYmlBZ1gwTnNZWE56TG5CeWIzUnZkSGx3WlM1emRHRjBkWE1nUFNBbkp6dGNibHh1SUNCbWRXNWpkR2x2YmlCZlEyeGhjM01vS1NCN1hHNGdJQ0FnYUdGd2NHVnVjeWgwYUdsektUdGNiaUFnZlZ4dVhHNGdJRjlEYkdGemN5NXdjbTkwYjNSNWNHVXVjMlYwWDJaeVlXMWxJRDBnWm5WdVkzUnBiMjRvWm5KaGJXVXhLU0I3WEc0Z0lDQWdkR2hwY3k1bWNtRnRaU0E5SUdaeVlXMWxNVHRjYmlBZ0lDQnlaWFIxY200Z2RHaHBjeTV3WlhKalpXNTBJRDBnZEdocGN5NW1jbUZ0WlNBdklIUm9hWE11ZEc5MFlXeGZabkpoYldWek8xeHVJQ0I5TzF4dVhHNGdJRjlEYkdGemN5NXdjbTkwYjNSNWNHVXVaMlYwWDJaeVlXMWxJRDBnWm5WdVkzUnBiMjRvS1NCN1hHNGdJQ0FnY21WMGRYSnVJSFJvYVhNdVpuSmhiV1U3WEc0Z0lIMDdYRzVjYmlBZ1gwTnNZWE56TG5CeWIzUnZkSGx3WlM1blpYUmZabkpoYldVZ1BTQm1kVzVqZEdsdmJpZ3BJSHRjYmlBZ0lDQjJZWElnWm5KaGJXVTdYRzRnSUNBZ1puSmhiV1VnUFNCTllYUm9MbVpzYjI5eUtIUm9hWE11Wm5KaGJXVXBPMXh1SUNBZ0lHWnlZVzFsSUQwZ1RXRjBhQzV0YVc0b1puSmhiV1VzSUhSb2FYTXVkRzkwWVd4ZlpuSmhiV1Z6S1R0Y2JpQWdJQ0J5WlhSMWNtNGdabkpoYldVZ1BTQk5ZWFJvTG0xaGVDaG1jbUZ0WlN3Z01DazdYRzRnSUgwN1hHNWNiaUFnY21WMGRYSnVJRjlEYkdGemN6dGNibHh1ZlNrb0tUdGNiaUpkZlE9PSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBTZXF1ZW5jZVBsYXllciwgVXRpbCxcbiAgYmluZCA9IGZ1bmN0aW9uKGZuLCBtZSl7IHJldHVybiBmdW5jdGlvbigpeyByZXR1cm4gZm4uYXBwbHkobWUsIGFyZ3VtZW50cyk7IH07IH07XG5cbm1vZHVsZS5leHBvcnRzID0gU2VxdWVuY2VQbGF5ZXIgPSAoZnVuY3Rpb24oKSB7XG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS5tb2RlID0gbnVsbDtcblxuICBTZXF1ZW5jZVBsYXllci5wcm90b3R5cGUuY3VycmVudF9mcmFtZSA9IG51bGw7XG5cbiAgU2VxdWVuY2VQbGF5ZXIucHJvdG90eXBlLmZyYW1lX3dpZHRoID0gMDtcblxuICBTZXF1ZW5jZVBsYXllci5wcm90b3R5cGUuZnJhbWVfaGVpZ2h0ID0gMDtcblxuICBmdW5jdGlvbiBTZXF1ZW5jZVBsYXllcihlbCkge1xuICAgIHRoaXMuZWwgPSBlbDtcbiAgICB0aGlzLmZ1bGxzY3JlZW5fcmVzaXplID0gYmluZCh0aGlzLmZ1bGxzY3JlZW5fcmVzaXplLCB0aGlzKTtcbiAgICB0aGlzLnVwZGF0ZSA9IGJpbmQodGhpcy51cGRhdGUsIHRoaXMpO1xuICAgIHRoaXMuc2V0X3NpemUgPSBiaW5kKHRoaXMuc2V0X3NpemUsIHRoaXMpO1xuXG4gICAgLypcbiAgICBcdFx0Q3JlYXRlIGZyYW1lXG4gICAgICovXG4gICAgdGhpcy5pbWFnZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2ltZycpO1xuICAgIHRoaXMuZWwuYXBwZW5kQ2hpbGQodGhpcy5pbWFnZSk7XG4gICAgdGhpcy5idWZmZXIgPSBbXTtcbiAgfVxuXG5cbiAgLypcbiAgXHRVcGRhdGUgdGhlIGltYWdlcyBidWZmZXJcbiAgICovXG5cbiAgU2VxdWVuY2VQbGF5ZXIucHJvdG90eXBlLnVwZGF0ZV9idWZmZXIgPSBmdW5jdGlvbihpbWFnZXMpIHtcbiAgICByZXR1cm4gdGhpcy5idWZmZXIgPSB0aGlzLmJ1ZmZlci5jb25jYXQoaW1hZ2VzKTtcbiAgfTtcblxuXG4gIC8qXG4gIFx0U2V0IHRoZSBzaXplIG9mIHRoZSBwbGF5ZXJcbiAgICovXG5cbiAgU2VxdWVuY2VQbGF5ZXIucHJvdG90eXBlLnNldF9zaXplID0gZnVuY3Rpb24od2lkdGgsIGhlaWdodCkge1xuICAgIHRoaXMud2lkdGggPSB3aWR0aDtcbiAgICB0aGlzLmhlaWdodCA9IGhlaWdodDtcbiAgICB0aGlzLmVsLnN0eWxlLndpZHRoID0gdGhpcy53aWR0aCArIFwicHhcIjtcbiAgICB0aGlzLmVsLnN0eWxlLmhlaWdodCA9IHRoaXMuaGVpZ2h0ICsgXCJweFwiO1xuICAgIHJldHVybiBVdGlsLnJlc2l6ZSh0aGlzLmltYWdlLCB0aGlzLmZyYW1lX3dpZHRoLCB0aGlzLmZyYW1lX2hlaWdodCwgdGhpcy53aWR0aCwgdGhpcy5oZWlnaHQpO1xuICB9O1xuXG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS5zZXRfbW9kZSA9IGZ1bmN0aW9uKG1vZGUpIHtcbiAgICB2YXIgcmVmO1xuICAgIGlmICgocmVmID0gdGhpcy5tb2RlKSAhPSBudWxsKSB7XG4gICAgICByZWYub2ZmKCd1cGRhdGUnLCB0aGlzLnVwZGF0ZSk7XG4gICAgfVxuICAgIHRoaXMubW9kZSA9IG1vZGU7XG4gICAgcmV0dXJuIHRoaXMubW9kZS5vbigndXBkYXRlJywgdGhpcy51cGRhdGUpO1xuICB9O1xuXG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZnJhbWUsIGltYWdlO1xuICAgIGlmICh0aGlzLm1vZGUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmcmFtZSA9IHRoaXMubW9kZS5nZXRfZnJhbWUoKTtcbiAgICBpZiAoZnJhbWUgIT09IHRoaXMuY3VycmVudF9mcmFtZSkge1xuICAgICAgdGhpcy5jdXJyZW50X2ZyYW1lID0gZnJhbWU7XG4gICAgICBpbWFnZSA9IHRoaXMuYnVmZmVyW3RoaXMuY3VycmVudF9mcmFtZV07XG4gICAgICBpZiAoaW1hZ2UgPT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5tb2RlLnBhdXNlKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdGhpcy5pbWFnZS5zZXRBdHRyaWJ1dGUoJ3NyYycsIGltYWdlLnNyYyk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS5nZXRfY3VycmVudF9mcmFtZV9pbWFnZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmJ1ZmZlclt0aGlzLmN1cnJlbnRfZnJhbWVdO1xuICB9O1xuXG5cbiAgLypcbiAgXHRFbmFibGUgdGhlIGF1dG9tYXRpYyByZXNpemluZyBvZiB0aGUgc2VxdWVuY2VyIGNvbnRhaW5lciBvbiB3aW5kb3cgcmVzaXplXG4gICAqL1xuXG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS5lbmFibGVfZnVsbHNjcmVlbl9yZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgdGhpcy5mdWxsc2NyZWVuX3Jlc2l6ZSk7XG4gICAgcmV0dXJuIHRoaXMuZnVsbHNjcmVlbl9yZXNpemUoKTtcbiAgfTtcblxuXG4gIC8qXG4gIFx0RGlzYWJsZSB0aGUgYXV0b21hdGljIHJlc2l6aW5nIG9mIHRoZSBzZXF1ZW5jZXIgY29udGFpbmVyIG9uIHdpbmRvdyByZXNpemVcbiAgICovXG5cbiAgU2VxdWVuY2VQbGF5ZXIucHJvdG90eXBlLmRpc2FibGVfZnVsbHNjcmVlbl9yZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIHRoaXMuZnVsbHNjcmVlbl9yZXNpemUpO1xuICB9O1xuXG4gIFNlcXVlbmNlUGxheWVyLnByb3RvdHlwZS5mdWxsc2NyZWVuX3Jlc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLnNldF9zaXplKHdpbmRvdy5pbm5lcldpZHRoLCB3aW5kb3cuaW5uZXJIZWlnaHQpO1xuICB9O1xuXG4gIHJldHVybiBTZXF1ZW5jZVBsYXllcjtcblxufSkoKTtcblxuVXRpbCA9IHtcbiAgY2FsY3VsYXRlX3Jlc2l6ZTogZnVuY3Rpb24oaW1hZ2Vfd2lkdGgsIGltYWdlX2hlaWdodCwgd2luX3dpZHRoLCB3aW5faGVpZ2h0KSB7XG4gICAgdmFyIGltYWdlX3JhdGlvMSwgaW1hZ2VfcmF0aW8yLCBuZXdfaGVpZ2h0LCBuZXdfbGVmdCwgbmV3X3RvcCwgbmV3X3dpZHRoLCB3aW5kb3dfcmF0aW87XG4gICAgd2luZG93X3JhdGlvID0gd2luX3dpZHRoIC8gd2luX2hlaWdodDtcbiAgICBpbWFnZV9yYXRpbzEgPSBpbWFnZV93aWR0aCAvIGltYWdlX2hlaWdodDtcbiAgICBpbWFnZV9yYXRpbzIgPSBpbWFnZV9oZWlnaHQgLyBpbWFnZV93aWR0aDtcbiAgICBpZiAod2luZG93X3JhdGlvIDwgaW1hZ2VfcmF0aW8xKSB7XG4gICAgICBuZXdfaGVpZ2h0ID0gd2luX2hlaWdodDtcbiAgICAgIG5ld193aWR0aCA9IE1hdGgucm91bmQobmV3X2hlaWdodCAqIGltYWdlX3JhdGlvMSk7XG4gICAgICBuZXdfdG9wID0gMDtcbiAgICAgIG5ld19sZWZ0ID0gKHdpbl93aWR0aCAqIC41KSAtIChuZXdfd2lkdGggKiAuNSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ld193aWR0aCA9IHdpbl93aWR0aDtcbiAgICAgIG5ld19oZWlnaHQgPSBNYXRoLnJvdW5kKG5ld193aWR0aCAqIGltYWdlX3JhdGlvMik7XG4gICAgICBuZXdfdG9wID0gKHdpbl9oZWlnaHQgKiAuNSkgLSAobmV3X2hlaWdodCAqIC41KTtcbiAgICAgIG5ld19sZWZ0ID0gMDtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIHg6IG5ld19sZWZ0LFxuICAgICAgeTogbmV3X3RvcCxcbiAgICAgIHdpZHRoOiBuZXdfd2lkdGgsXG4gICAgICBoZWlnaHQ6IG5ld19oZWlnaHRcbiAgICB9O1xuICB9LFxuXG4gIC8qXG4gIFx0UmVzaXplIGltYWdlKHMpIHRvIHRoZSBicm93c2VyIHNpemUgcmV0YWluaW5nIGFzcGVjdCByYXRpb1xuICBcdEBwYXJhbSBbalF1ZXJ5XSAgJGltYWdlc1xuICBcdEBwYXJhbSBbTnVtYmVyXSAgaW1hZ2Vfd2lkdGhcbiAgXHRAcGFyYW0gW051bWJlcl0gIGltYWdlX2hlaWdodFxuICBcdEBwYXJhbSBbTnVtYmVyXSAgd2luX3dpZHRoXG4gIFx0QHBhcmFtIFtOdW1iZXJdICB3aW5fd2lkdGhcbiAgXHRAcGFyYW0gW0Jvb2xlYW5dIGJhY2tncm91bmRzaXplXG4gICAqL1xuICByZXNpemU6IGZ1bmN0aW9uKGltYWdlLCBpbWFnZV93aWR0aCwgaW1hZ2VfaGVpZ2h0LCB3aW5fd2lkdGgsIHdpbl9oZWlnaHQpIHtcbiAgICB2YXIgZGF0YTtcbiAgICBkYXRhID0gdGhpcy5jYWxjdWxhdGVfcmVzaXplKGltYWdlX3dpZHRoLCBpbWFnZV9oZWlnaHQsIHdpbl93aWR0aCwgd2luX2hlaWdodCk7XG4gICAgaW1hZ2Uuc3R5bGUubWFyZ2luVG9wID0gZGF0YS55ICsgXCJweFwiO1xuICAgIGltYWdlLnN0eWxlLm1hcmdpbkxlZnQgPSBkYXRhLnggKyBcInB4XCI7XG4gICAgaW1hZ2Uuc3R5bGUud2lkdGggPSBkYXRhLndpZHRoICsgXCJweFwiO1xuICAgIHJldHVybiBpbWFnZS5zdHlsZS5oZWlnaHQgPSBkYXRhLmhlaWdodCArIFwicHhcIjtcbiAgfVxufTtcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoJ19wcm9jZXNzJyksdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvcGxheWVyLmNvZmZlZVwiLFwiL1wiKVxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9ZGF0YTphcHBsaWNhdGlvbi9qc29uO2NoYXJzZXQ6dXRmLTg7YmFzZTY0LGV5SjJaWEp6YVc5dUlqb3pMQ0p6YjNWeVkyVnpJanBiSW5Cc1lYbGxjaTVqYjJabVpXVWlYU3dpYm1GdFpYTWlPbHRkTENKdFlYQndhVzVuY3lJNklqdEJRVUZCTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFaUxDSm1hV3hsSWpvaVoyVnVaWEpoZEdWa0xtcHpJaXdpYzI5MWNtTmxVbTl2ZENJNklpSXNJbk52ZFhKalpYTkRiMjUwWlc1MElqcGJJblpoY2lCVFpYRjFaVzVqWlZCc1lYbGxjaXdnVlhScGJDeGNiaUFnWW1sdVpDQTlJR1oxYm1OMGFXOXVLR1p1TENCdFpTbDdJSEpsZEhWeWJpQm1kVzVqZEdsdmJpZ3BleUJ5WlhSMWNtNGdabTR1WVhCd2JIa29iV1VzSUdGeVozVnRaVzUwY3lrN0lIMDdJSDA3WEc1Y2JtMXZaSFZzWlM1bGVIQnZjblJ6SUQwZ1UyVnhkV1Z1WTJWUWJHRjVaWElnUFNBb1puVnVZM1JwYjI0b0tTQjdYRzRnSUZObGNYVmxibU5sVUd4aGVXVnlMbkJ5YjNSdmRIbHdaUzV0YjJSbElEMGdiblZzYkR0Y2JseHVJQ0JUWlhGMVpXNWpaVkJzWVhsbGNpNXdjbTkwYjNSNWNHVXVZM1Z5Y21WdWRGOW1jbUZ0WlNBOUlHNTFiR3c3WEc1Y2JpQWdVMlZ4ZFdWdVkyVlFiR0Y1WlhJdWNISnZkRzkwZVhCbExtWnlZVzFsWDNkcFpIUm9JRDBnTUR0Y2JseHVJQ0JUWlhGMVpXNWpaVkJzWVhsbGNpNXdjbTkwYjNSNWNHVXVabkpoYldWZmFHVnBaMmgwSUQwZ01EdGNibHh1SUNCbWRXNWpkR2x2YmlCVFpYRjFaVzVqWlZCc1lYbGxjaWhsYkNrZ2UxeHVJQ0FnSUhSb2FYTXVaV3dnUFNCbGJEdGNiaUFnSUNCMGFHbHpMbVoxYkd4elkzSmxaVzVmY21WemFYcGxJRDBnWW1sdVpDaDBhR2x6TG1aMWJHeHpZM0psWlc1ZmNtVnphWHBsTENCMGFHbHpLVHRjYmlBZ0lDQjBhR2x6TG5Wd1pHRjBaU0E5SUdKcGJtUW9kR2hwY3k1MWNHUmhkR1VzSUhSb2FYTXBPMXh1SUNBZ0lIUm9hWE11YzJWMFgzTnBlbVVnUFNCaWFXNWtLSFJvYVhNdWMyVjBYM05wZW1Vc0lIUm9hWE1wTzF4dVhHNGdJQ0FnTHlwY2JpQWdJQ0JjZEZ4MFEzSmxZWFJsSUdaeVlXMWxYRzRnSUNBZ0lDb3ZYRzRnSUNBZ2RHaHBjeTVwYldGblpTQTlJR1J2WTNWdFpXNTBMbU55WldGMFpVVnNaVzFsYm5Rb0oybHRaeWNwTzF4dUlDQWdJSFJvYVhNdVpXd3VZWEJ3Wlc1a1EyaHBiR1FvZEdocGN5NXBiV0ZuWlNrN1hHNGdJQ0FnZEdocGN5NWlkV1ptWlhJZ1BTQmJYVHRjYmlBZ2ZWeHVYRzVjYmlBZ0x5cGNiaUFnWEhSVmNHUmhkR1VnZEdobElHbHRZV2RsY3lCaWRXWm1aWEpjYmlBZ0lDb3ZYRzVjYmlBZ1UyVnhkV1Z1WTJWUWJHRjVaWEl1Y0hKdmRHOTBlWEJsTG5Wd1pHRjBaVjlpZFdabVpYSWdQU0JtZFc1amRHbHZiaWhwYldGblpYTXBJSHRjYmlBZ0lDQnlaWFIxY200Z2RHaHBjeTVpZFdabVpYSWdQU0IwYUdsekxtSjFabVpsY2k1amIyNWpZWFFvYVcxaFoyVnpLVHRjYmlBZ2ZUdGNibHh1WEc0Z0lDOHFYRzRnSUZ4MFUyVjBJSFJvWlNCemFYcGxJRzltSUhSb1pTQndiR0Y1WlhKY2JpQWdJQ292WEc1Y2JpQWdVMlZ4ZFdWdVkyVlFiR0Y1WlhJdWNISnZkRzkwZVhCbExuTmxkRjl6YVhwbElEMGdablZ1WTNScGIyNG9kMmxrZEdnc0lHaGxhV2RvZENrZ2UxeHVJQ0FnSUhSb2FYTXVkMmxrZEdnZ1BTQjNhV1IwYUR0Y2JpQWdJQ0IwYUdsekxtaGxhV2RvZENBOUlHaGxhV2RvZER0Y2JpQWdJQ0IwYUdsekxtVnNMbk4wZVd4bExuZHBaSFJvSUQwZ2RHaHBjeTUzYVdSMGFDQXJJRndpY0hoY0lqdGNiaUFnSUNCMGFHbHpMbVZzTG5OMGVXeGxMbWhsYVdkb2RDQTlJSFJvYVhNdWFHVnBaMmgwSUNzZ1hDSndlRndpTzF4dUlDQWdJSEpsZEhWeWJpQlZkR2xzTG5KbGMybDZaU2gwYUdsekxtbHRZV2RsTENCMGFHbHpMbVp5WVcxbFgzZHBaSFJvTENCMGFHbHpMbVp5WVcxbFgyaGxhV2RvZEN3Z2RHaHBjeTUzYVdSMGFDd2dkR2hwY3k1b1pXbG5hSFFwTzF4dUlDQjlPMXh1WEc0Z0lGTmxjWFZsYm1ObFVHeGhlV1Z5TG5CeWIzUnZkSGx3WlM1elpYUmZiVzlrWlNBOUlHWjFibU4wYVc5dUtHMXZaR1VwSUh0Y2JpQWdJQ0IyWVhJZ2NtVm1PMXh1SUNBZ0lHbG1JQ2dvY21WbUlEMGdkR2hwY3k1dGIyUmxLU0FoUFNCdWRXeHNLU0I3WEc0Z0lDQWdJQ0J5WldZdWIyWm1LQ2QxY0dSaGRHVW5MQ0IwYUdsekxuVndaR0YwWlNrN1hHNGdJQ0FnZlZ4dUlDQWdJSFJvYVhNdWJXOWtaU0E5SUcxdlpHVTdYRzRnSUNBZ2NtVjBkWEp1SUhSb2FYTXViVzlrWlM1dmJpZ25kWEJrWVhSbEp5d2dkR2hwY3k1MWNHUmhkR1VwTzF4dUlDQjlPMXh1WEc0Z0lGTmxjWFZsYm1ObFVHeGhlV1Z5TG5CeWIzUnZkSGx3WlM1MWNHUmhkR1VnUFNCbWRXNWpkR2x2YmlncElIdGNiaUFnSUNCMllYSWdabkpoYldVc0lHbHRZV2RsTzF4dUlDQWdJR2xtSUNoMGFHbHpMbTF2WkdVZ1BUMGdiblZzYkNrZ2UxeHVJQ0FnSUNBZ2NtVjBkWEp1TzF4dUlDQWdJSDFjYmlBZ0lDQm1jbUZ0WlNBOUlIUm9hWE11Ylc5a1pTNW5aWFJmWm5KaGJXVW9LVHRjYmlBZ0lDQnBaaUFvWm5KaGJXVWdJVDA5SUhSb2FYTXVZM1Z5Y21WdWRGOW1jbUZ0WlNrZ2UxeHVJQ0FnSUNBZ2RHaHBjeTVqZFhKeVpXNTBYMlp5WVcxbElEMGdabkpoYldVN1hHNGdJQ0FnSUNCcGJXRm5aU0E5SUhSb2FYTXVZblZtWm1WeVczUm9hWE11WTNWeWNtVnVkRjltY21GdFpWMDdYRzRnSUNBZ0lDQnBaaUFvYVcxaFoyVWdQVDBnYm5Wc2JDa2dlMXh1SUNBZ0lDQWdJQ0J5WlhSMWNtNGdkR2hwY3k1dGIyUmxMbkJoZFhObEtDazdYRzRnSUNBZ0lDQjlJR1ZzYzJVZ2UxeHVJQ0FnSUNBZ0lDQnlaWFIxY200Z2RHaHBjeTVwYldGblpTNXpaWFJCZEhSeWFXSjFkR1VvSjNOeVl5Y3NJR2x0WVdkbExuTnlZeWs3WEc0Z0lDQWdJQ0I5WEc0Z0lDQWdmVnh1SUNCOU8xeHVYRzRnSUZObGNYVmxibU5sVUd4aGVXVnlMbkJ5YjNSdmRIbHdaUzVuWlhSZlkzVnljbVZ1ZEY5bWNtRnRaVjlwYldGblpTQTlJR1oxYm1OMGFXOXVLQ2tnZTF4dUlDQWdJSEpsZEhWeWJpQjBhR2x6TG1KMVptWmxjbHQwYUdsekxtTjFjbkpsYm5SZlpuSmhiV1ZkTzF4dUlDQjlPMXh1WEc1Y2JpQWdMeXBjYmlBZ1hIUkZibUZpYkdVZ2RHaGxJR0YxZEc5dFlYUnBZeUJ5WlhOcGVtbHVaeUJ2WmlCMGFHVWdjMlZ4ZFdWdVkyVnlJR052Ym5SaGFXNWxjaUJ2YmlCM2FXNWtiM2NnY21WemFYcGxYRzRnSUNBcUwxeHVYRzRnSUZObGNYVmxibU5sVUd4aGVXVnlMbkJ5YjNSdmRIbHdaUzVsYm1GaWJHVmZablZzYkhOamNtVmxibDl5WlhOcGVtVWdQU0JtZFc1amRHbHZiaWdwSUh0Y2JpQWdJQ0IzYVc1a2IzY3VZV1JrUlhabGJuUk1hWE4wWlc1bGNpZ25jbVZ6YVhwbEp5d2dkR2hwY3k1bWRXeHNjMk55WldWdVgzSmxjMmw2WlNrN1hHNGdJQ0FnY21WMGRYSnVJSFJvYVhNdVpuVnNiSE5qY21WbGJsOXlaWE5wZW1Vb0tUdGNiaUFnZlR0Y2JseHVYRzRnSUM4cVhHNGdJRngwUkdsellXSnNaU0IwYUdVZ1lYVjBiMjFoZEdsaklISmxjMmw2YVc1bklHOW1JSFJvWlNCelpYRjFaVzVqWlhJZ1kyOXVkR0ZwYm1WeUlHOXVJSGRwYm1SdmR5QnlaWE5wZW1WY2JpQWdJQ292WEc1Y2JpQWdVMlZ4ZFdWdVkyVlFiR0Y1WlhJdWNISnZkRzkwZVhCbExtUnBjMkZpYkdWZlpuVnNiSE5qY21WbGJsOXlaWE5wZW1VZ1BTQm1kVzVqZEdsdmJpZ3BJSHRjYmlBZ0lDQnlaWFIxY200Z2QybHVaRzkzTG5KbGJXOTJaVVYyWlc1MFRHbHpkR1Z1WlhJb0ozSmxjMmw2WlNjc0lIUm9hWE11Wm5Wc2JITmpjbVZsYmw5eVpYTnBlbVVwTzF4dUlDQjlPMXh1WEc0Z0lGTmxjWFZsYm1ObFVHeGhlV1Z5TG5CeWIzUnZkSGx3WlM1bWRXeHNjMk55WldWdVgzSmxjMmw2WlNBOUlHWjFibU4wYVc5dUtDa2dlMXh1SUNBZ0lISmxkSFZ5YmlCMGFHbHpMbk5sZEY5emFYcGxLSGRwYm1SdmR5NXBibTVsY2xkcFpIUm9MQ0IzYVc1a2IzY3VhVzV1WlhKSVpXbG5hSFFwTzF4dUlDQjlPMXh1WEc0Z0lISmxkSFZ5YmlCVFpYRjFaVzVqWlZCc1lYbGxjanRjYmx4dWZTa29LVHRjYmx4dVZYUnBiQ0E5SUh0Y2JpQWdZMkZzWTNWc1lYUmxYM0psYzJsNlpUb2dablZ1WTNScGIyNG9hVzFoWjJWZmQybGtkR2dzSUdsdFlXZGxYMmhsYVdkb2RDd2dkMmx1WDNkcFpIUm9MQ0IzYVc1ZmFHVnBaMmgwS1NCN1hHNGdJQ0FnZG1GeUlHbHRZV2RsWDNKaGRHbHZNU3dnYVcxaFoyVmZjbUYwYVc4eUxDQnVaWGRmYUdWcFoyaDBMQ0J1WlhkZmJHVm1kQ3dnYm1WM1gzUnZjQ3dnYm1WM1gzZHBaSFJvTENCM2FXNWtiM2RmY21GMGFXODdYRzRnSUNBZ2QybHVaRzkzWDNKaGRHbHZJRDBnZDJsdVgzZHBaSFJvSUM4Z2QybHVYMmhsYVdkb2REdGNiaUFnSUNCcGJXRm5aVjl5WVhScGJ6RWdQU0JwYldGblpWOTNhV1IwYUNBdklHbHRZV2RsWDJobGFXZG9kRHRjYmlBZ0lDQnBiV0ZuWlY5eVlYUnBieklnUFNCcGJXRm5aVjlvWldsbmFIUWdMeUJwYldGblpWOTNhV1IwYUR0Y2JpQWdJQ0JwWmlBb2QybHVaRzkzWDNKaGRHbHZJRHdnYVcxaFoyVmZjbUYwYVc4eEtTQjdYRzRnSUNBZ0lDQnVaWGRmYUdWcFoyaDBJRDBnZDJsdVgyaGxhV2RvZER0Y2JpQWdJQ0FnSUc1bGQxOTNhV1IwYUNBOUlFMWhkR2d1Y205MWJtUW9ibVYzWDJobGFXZG9kQ0FxSUdsdFlXZGxYM0poZEdsdk1TazdYRzRnSUNBZ0lDQnVaWGRmZEc5d0lEMGdNRHRjYmlBZ0lDQWdJRzVsZDE5c1pXWjBJRDBnS0hkcGJsOTNhV1IwYUNBcUlDNDFLU0F0SUNodVpYZGZkMmxrZEdnZ0tpQXVOU2s3WEc0Z0lDQWdmU0JsYkhObElIdGNiaUFnSUNBZ0lHNWxkMTkzYVdSMGFDQTlJSGRwYmw5M2FXUjBhRHRjYmlBZ0lDQWdJRzVsZDE5b1pXbG5hSFFnUFNCTllYUm9Mbkp2ZFc1a0tHNWxkMTkzYVdSMGFDQXFJR2x0WVdkbFgzSmhkR2x2TWlrN1hHNGdJQ0FnSUNCdVpYZGZkRzl3SUQwZ0tIZHBibDlvWldsbmFIUWdLaUF1TlNrZ0xTQW9ibVYzWDJobGFXZG9kQ0FxSUM0MUtUdGNiaUFnSUNBZ0lHNWxkMTlzWldaMElEMGdNRHRjYmlBZ0lDQjlYRzRnSUNBZ2NtVjBkWEp1SUh0Y2JpQWdJQ0FnSUhnNklHNWxkMTlzWldaMExGeHVJQ0FnSUNBZ2VUb2dibVYzWDNSdmNDeGNiaUFnSUNBZ0lIZHBaSFJvT2lCdVpYZGZkMmxrZEdnc1hHNGdJQ0FnSUNCb1pXbG5hSFE2SUc1bGQxOW9aV2xuYUhSY2JpQWdJQ0I5TzF4dUlDQjlMRnh1WEc0Z0lDOHFYRzRnSUZ4MFVtVnphWHBsSUdsdFlXZGxLSE1wSUhSdklIUm9aU0JpY205M2MyVnlJSE5wZW1VZ2NtVjBZV2x1YVc1bklHRnpjR1ZqZENCeVlYUnBiMXh1SUNCY2RFQndZWEpoYlNCYmFsRjFaWEo1WFNBZ0pHbHRZV2RsYzF4dUlDQmNkRUJ3WVhKaGJTQmJUblZ0WW1WeVhTQWdhVzFoWjJWZmQybGtkR2hjYmlBZ1hIUkFjR0Z5WVcwZ1cwNTFiV0psY2wwZ0lHbHRZV2RsWDJobGFXZG9kRnh1SUNCY2RFQndZWEpoYlNCYlRuVnRZbVZ5WFNBZ2QybHVYM2RwWkhSb1hHNGdJRngwUUhCaGNtRnRJRnRPZFcxaVpYSmRJQ0IzYVc1ZmQybGtkR2hjYmlBZ1hIUkFjR0Z5WVcwZ1cwSnZiMnhsWVc1ZElHSmhZMnRuY205MWJtUnphWHBsWEc0Z0lDQXFMMXh1SUNCeVpYTnBlbVU2SUdaMWJtTjBhVzl1S0dsdFlXZGxMQ0JwYldGblpWOTNhV1IwYUN3Z2FXMWhaMlZmYUdWcFoyaDBMQ0IzYVc1ZmQybGtkR2dzSUhkcGJsOW9aV2xuYUhRcElIdGNiaUFnSUNCMllYSWdaR0YwWVR0Y2JpQWdJQ0JrWVhSaElEMGdkR2hwY3k1allXeGpkV3hoZEdWZmNtVnphWHBsS0dsdFlXZGxYM2RwWkhSb0xDQnBiV0ZuWlY5b1pXbG5hSFFzSUhkcGJsOTNhV1IwYUN3Z2QybHVYMmhsYVdkb2RDazdYRzRnSUNBZ2FXMWhaMlV1YzNSNWJHVXViV0Z5WjJsdVZHOXdJRDBnWkdGMFlTNTVJQ3NnWENKd2VGd2lPMXh1SUNBZ0lHbHRZV2RsTG5OMGVXeGxMbTFoY21kcGJreGxablFnUFNCa1lYUmhMbmdnS3lCY0luQjRYQ0k3WEc0Z0lDQWdhVzFoWjJVdWMzUjViR1V1ZDJsa2RHZ2dQU0JrWVhSaExuZHBaSFJvSUNzZ1hDSndlRndpTzF4dUlDQWdJSEpsZEhWeWJpQnBiV0ZuWlM1emRIbHNaUzVvWldsbmFIUWdQU0JrWVhSaExtaGxhV2RvZENBcklGd2ljSGhjSWp0Y2JpQWdmVnh1ZlR0Y2JpSmRmUT09IiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xubW9kdWxlLmV4cG9ydHMgPSB7XG5cbiAgLypcbiAgXHRodHRwczovL2dpc3QuZ2l0aHViLmNvbS9zdmxhc292LWdpc3RzLzIzODM3NTFcbiAgICovXG4gIG1lcmdlOiBmdW5jdGlvbih0YXJnZXQsIHNvdXJjZSkge1xuICAgIHZhciBhLCBsLCBwcm9wZXJ0eSwgc291cmNlUHJvcGVydHk7XG4gICAgaWYgKHR5cGVvZiB0YXJnZXQgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHRhcmdldCA9IHt9O1xuICAgIH1cbiAgICBmb3IgKHByb3BlcnR5IGluIHNvdXJjZSkge1xuICAgICAgaWYgKHNvdXJjZS5oYXNPd25Qcm9wZXJ0eShwcm9wZXJ0eSkpIHtcbiAgICAgICAgc291cmNlUHJvcGVydHkgPSBzb3VyY2VbcHJvcGVydHldO1xuICAgICAgICBpZiAodHlwZW9mIHNvdXJjZVByb3BlcnR5ID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgICAgdGFyZ2V0W3Byb3BlcnR5XSA9IHRoaXMubWVyZ2UodGFyZ2V0W3Byb3BlcnR5XSwgc291cmNlUHJvcGVydHkpO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIHRhcmdldFtwcm9wZXJ0eV0gPSBzb3VyY2VQcm9wZXJ0eTtcbiAgICAgIH1cbiAgICB9XG4gICAgYSA9IDI7XG4gICAgbCA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgd2hpbGUgKGEgPCBsKSB7XG4gICAgICBtZXJnZSh0YXJnZXQsIGFyZ3VtZW50c1thXSk7XG4gICAgICBhKys7XG4gICAgfVxuICAgIHJldHVybiB0YXJnZXQ7XG4gIH1cbn07XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKCdfcHJvY2VzcycpLHR5cGVvZiBnbG9iYWwgIT09IFwidW5kZWZpbmVkXCIgPyBnbG9iYWwgOiB0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiL3V0aWxzLmNvZmZlZVwiLFwiL1wiKVxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9ZGF0YTphcHBsaWNhdGlvbi9qc29uO2NoYXJzZXQ6dXRmLTg7YmFzZTY0LGV5SjJaWEp6YVc5dUlqb3pMQ0p6YjNWeVkyVnpJanBiSW5WMGFXeHpMbU52Wm1abFpTSmRMQ0p1WVcxbGN5STZXMTBzSW0xaGNIQnBibWR6SWpvaU8wRkJRVUU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CSWl3aVptbHNaU0k2SW1kbGJtVnlZWFJsWkM1cWN5SXNJbk52ZFhKalpWSnZiM1FpT2lJaUxDSnpiM1Z5WTJWelEyOXVkR1Z1ZENJNld5SnRiMlIxYkdVdVpYaHdiM0owY3lBOUlIdGNibHh1SUNBdktseHVJQ0JjZEdoMGRIQnpPaTh2WjJsemRDNW5hWFJvZFdJdVkyOXRMM04yYkdGemIzWXRaMmx6ZEhNdk1qTTRNemMxTVZ4dUlDQWdLaTljYmlBZ2JXVnlaMlU2SUdaMWJtTjBhVzl1S0hSaGNtZGxkQ3dnYzI5MWNtTmxLU0I3WEc0Z0lDQWdkbUZ5SUdFc0lHd3NJSEJ5YjNCbGNuUjVMQ0J6YjNWeVkyVlFjbTl3WlhKMGVUdGNiaUFnSUNCcFppQW9kSGx3Wlc5bUlIUmhjbWRsZENBaFBUMGdYQ0p2WW1wbFkzUmNJaWtnZTF4dUlDQWdJQ0FnZEdGeVoyVjBJRDBnZTMwN1hHNGdJQ0FnZlZ4dUlDQWdJR1p2Y2lBb2NISnZjR1Z5ZEhrZ2FXNGdjMjkxY21ObEtTQjdYRzRnSUNBZ0lDQnBaaUFvYzI5MWNtTmxMbWhoYzA5M2JsQnliM0JsY25SNUtIQnliM0JsY25SNUtTa2dlMXh1SUNBZ0lDQWdJQ0J6YjNWeVkyVlFjbTl3WlhKMGVTQTlJSE52ZFhKalpWdHdjbTl3WlhKMGVWMDdYRzRnSUNBZ0lDQWdJR2xtSUNoMGVYQmxiMllnYzI5MWNtTmxVSEp2Y0dWeWRIa2dQVDA5SUZ3aWIySnFaV04wWENJcElIdGNiaUFnSUNBZ0lDQWdJQ0IwWVhKblpYUmJjSEp2Y0dWeWRIbGRJRDBnZEdocGN5NXRaWEpuWlNoMFlYSm5aWFJiY0hKdmNHVnlkSGxkTENCemIzVnlZMlZRY205d1pYSjBlU2s3WEc0Z0lDQWdJQ0FnSUNBZ1kyOXVkR2x1ZFdVN1hHNGdJQ0FnSUNBZ0lIMWNiaUFnSUNBZ0lDQWdkR0Z5WjJWMFczQnliM0JsY25SNVhTQTlJSE52ZFhKalpWQnliM0JsY25SNU8xeHVJQ0FnSUNBZ2ZWeHVJQ0FnSUgxY2JpQWdJQ0JoSUQwZ01qdGNiaUFnSUNCc0lEMGdZWEpuZFcxbGJuUnpMbXhsYm1kMGFEdGNiaUFnSUNCM2FHbHNaU0FvWVNBOElHd3BJSHRjYmlBZ0lDQWdJRzFsY21kbEtIUmhjbWRsZEN3Z1lYSm5kVzFsYm5SelcyRmRLVHRjYmlBZ0lDQWdJR0VyS3p0Y2JpQWdJQ0I5WEc0Z0lDQWdjbVYwZFhKdUlIUmhjbWRsZER0Y2JpQWdmVnh1ZlR0Y2JpSmRmUT09IiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIFNlcXVlbmNlTG9hZGVyLCBTZXF1ZW5jZVBsYXllciwgVXRpbHMsIFZpbWFnZSwgaGFwcGVucyxcbiAgYmluZCA9IGZ1bmN0aW9uKGZuLCBtZSl7IHJldHVybiBmdW5jdGlvbigpeyByZXR1cm4gZm4uYXBwbHkobWUsIGFyZ3VtZW50cyk7IH07IH07XG5cbmhhcHBlbnMgPSByZXF1aXJlKCdoYXBwZW5zJyk7XG5cblV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xuXG5TZXF1ZW5jZUxvYWRlciA9IHJlcXVpcmUoJy4vbG9hZGVyJyk7XG5cblNlcXVlbmNlUGxheWVyID0gcmVxdWlyZSgnLi9wbGF5ZXInKTtcblxubW9kdWxlLmV4cG9ydHMgPSB3aW5kb3cuVmltYWdlID0gVmltYWdlID0gKGZ1bmN0aW9uKCkge1xuICBmdW5jdGlvbiBWaW1hZ2Uob3B0aW9ucykge1xuICAgIGlmIChvcHRpb25zID09IG51bGwpIHtcbiAgICAgIG9wdGlvbnMgPSB7fTtcbiAgICB9XG4gICAgdGhpcy5idWZmZXJfY29tcGxldGUgPSBiaW5kKHRoaXMuYnVmZmVyX2NvbXBsZXRlLCB0aGlzKTtcbiAgICB0aGlzLnVwZGF0ZV9idWZmZXIgPSBiaW5kKHRoaXMudXBkYXRlX2J1ZmZlciwgdGhpcyk7XG4gICAgdGhpcy5kYXRhX2xvYWRlZCA9IGJpbmQodGhpcy5kYXRhX2xvYWRlZCwgdGhpcyk7XG4gICAgaGFwcGVucyh0aGlzKTtcbiAgICB0aGlzLm9wdGlvbnMgPSB7XG4gICAgICAnZWxlbWVudCc6IG51bGwsXG4gICAgICAnYXV0b3BsYXknOiB0cnVlLFxuICAgICAgJ2Z1bGxzY3JlZW4nOiBmYWxzZSxcbiAgICAgICdidWZmZXJfcGVyY2VudCc6IDAuMSxcbiAgICAgICd0eXBlJzogJ3ZpZGVvJ1xuICAgIH07XG4gICAgVXRpbHMubWVyZ2UodGhpcy5vcHRpb25zLCBvcHRpb25zKTtcbiAgICB0aGlzLm9wdGlvbnMuZWxlbWVudCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKHRoaXMub3B0aW9ucy5lbGVtZW50KTtcbiAgICB0aGlzLnBsYXllciA9IG5ldyBTZXF1ZW5jZVBsYXllcih0aGlzLm9wdGlvbnMuZWxlbWVudCk7XG4gICAgdGhpcy5tb2RlcyA9IHJlcXVpcmUoJy4vbW9kZXMnKTtcbiAgICB0aGlzLmxvYWRlciA9IG5ldyBTZXF1ZW5jZUxvYWRlcjtcbiAgfVxuXG4gIFZpbWFnZS5wcm90b3R5cGUubG9hZCA9IGZ1bmN0aW9uKGZpbGUpIHtcbiAgICB0aGlzLmxvYWRlci5vbignYnVmZmVyOnVwZGF0ZScsIHRoaXMudXBkYXRlX2J1ZmZlcik7XG4gICAgdGhpcy5sb2FkZXIub25jZSgnYnVmZmVyOmNvbXBsZXRlJywgdGhpcy5idWZmZXJfY29tcGxldGUpO1xuICAgIHRoaXMubG9hZGVyLm9uY2UoJ2RhdGE6bG9hZGVkJywgdGhpcy5kYXRhX2xvYWRlZCk7XG4gICAgcmV0dXJuIHRoaXMubG9hZGVyLmxvYWQoZmlsZSk7XG4gIH07XG5cbiAgVmltYWdlLnByb3RvdHlwZS5zZXRfbW9kZSA9IGZ1bmN0aW9uKG1vZGUpIHtcbiAgICB0aGlzLm1vZGUgPSBtb2RlO1xuICAgIHJldHVybiB0aGlzLnBsYXllci5zZXRfbW9kZSh0aGlzLm1vZGUpO1xuICB9O1xuXG4gIFZpbWFnZS5wcm90b3R5cGUuZGF0YV9sb2FkZWQgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnBsYXllci5mcmFtZV93aWR0aCA9IHRoaXMubG9hZGVyLmRhdGEud2lkdGg7XG4gICAgdGhpcy5wbGF5ZXIuZnJhbWVfaGVpZ2h0ID0gdGhpcy5sb2FkZXIuZGF0YS5oZWlnaHQ7XG4gICAgdGhpcy5wbGF5ZXIuc2V0X3NpemUodGhpcy5sb2FkZXIuZGF0YS53aWR0aCwgdGhpcy5sb2FkZXIuZGF0YS5oZWlnaHQpO1xuICAgIGlmICh0aGlzLm9wdGlvbnMuZnVsbHNjcmVlbikge1xuICAgICAgdGhpcy5wbGF5ZXIuZW5hYmxlX2Z1bGxzY3JlZW5fcmVzaXplKCk7XG4gICAgfVxuXG4gICAgLypcbiAgICBcdFx0UGxheSB0aGUgbW9kZSBhZnRlciB0aGUgZmlyc3QgcGFja3MgaGF2ZSBsb2FkZWRcbiAgICAgKi9cbiAgICByZXR1cm4gdGhpcy5tb2RlLnRvdGFsX2ZyYW1lcyA9IHRoaXMubG9hZGVyLmRhdGEudG90YWxfZnJhbWVzO1xuICB9O1xuXG5cbiAgLypcbiAgXHRVcGRhdGUgdGhlIGltYWdlcyBidWZmZXJcbiAgICovXG5cbiAgVmltYWdlLnByb3RvdHlwZS51cGRhdGVfYnVmZmVyID0gZnVuY3Rpb24oaW1hZ2VzKSB7XG4gICAgdGhpcy5wbGF5ZXIudXBkYXRlX2J1ZmZlcihpbWFnZXMpO1xuICAgIGlmICh0aGlzLm9wdGlvbnMudHlwZSA9PT0gJ3ZpZGVvJykge1xuICAgICAgaWYgKHRoaXMubW9kZS5wbGF5aW5nID09PSBmYWxzZSAmJiB0aGlzLm9wdGlvbnMuYXV0b3BsYXkgJiYgdGhpcy5sb2FkZXIucGVyY2VudF9sb2FkZWQgPj0gdGhpcy5vcHRpb25zLmJ1ZmZlcl9wZXJjZW50KSB7XG4gICAgICAgIHRoaXMubW9kZS5wbGF5KHRoaXMubG9hZGVyLmRhdGEuZHVyYXRpb24pO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMubW9kZS5wYXVzZSkge1xuICAgICAgICByZXR1cm4gdGhpcy5tb2RlLnJlc3VtZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuXG4gIC8qXG4gIFx0QWZ0ZXIgYWxsIHRoZSBwYWNrcyBoYXZlIGxvYWRlZFxuICAgKi9cblxuICBWaW1hZ2UucHJvdG90eXBlLmJ1ZmZlcl9jb21wbGV0ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubG9hZGVyLm9mZignbG9hZGVkJyk7XG4gICAgdGhpcy5sb2FkZXIub2ZmKCdidWZmZXI6dXBkYXRlJywgdGhpcy51cGRhdGVfYnVmZmVyKTtcbiAgICBpZiAodGhpcy5vcHRpb25zLnR5cGUgPT09ICd2aWRlbycpIHtcbiAgICAgIGlmICh0aGlzLm1vZGUucGxheWluZyA9PT0gZmFsc2UgJiYgdGhpcy5vcHRpb25zLmF1dG9wbGF5ICYmIHRoaXMubG9hZGVyLnBlcmNlbnRfbG9hZGVkID49IHRoaXMub3B0aW9ucy5idWZmZXJfcGVyY2VudCkge1xuICAgICAgICB0aGlzLm1vZGUucGxheSh0aGlzLmxvYWRlci5kYXRhLmR1cmF0aW9uKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZW1pdCgnbG9hZGVkJyk7XG4gIH07XG5cbiAgVmltYWdlLnByb3RvdHlwZS5wbGF5ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMubW9kZS5wbGF5KCk7XG4gIH07XG5cbiAgcmV0dXJuIFZpbWFnZTtcblxufSkoKTtcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoJ19wcm9jZXNzJyksdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvdmltYWdlLmNvZmZlZVwiLFwiL1wiKVxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9ZGF0YTphcHBsaWNhdGlvbi9qc29uO2NoYXJzZXQ6dXRmLTg7YmFzZTY0LGV5SjJaWEp6YVc5dUlqb3pMQ0p6YjNWeVkyVnpJanBiSW5acGJXRm5aUzVqYjJabVpXVWlYU3dpYm1GdFpYTWlPbHRkTENKdFlYQndhVzVuY3lJNklqdEJRVUZCTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRWlMQ0ptYVd4bElqb2laMlZ1WlhKaGRHVmtMbXB6SWl3aWMyOTFjbU5sVW05dmRDSTZJaUlzSW5OdmRYSmpaWE5EYjI1MFpXNTBJanBiSW5aaGNpQlRaWEYxWlc1alpVeHZZV1JsY2l3Z1UyVnhkV1Z1WTJWUWJHRjVaWElzSUZWMGFXeHpMQ0JXYVcxaFoyVXNJR2hoY0hCbGJuTXNYRzRnSUdKcGJtUWdQU0JtZFc1amRHbHZiaWhtYml3Z2JXVXBleUJ5WlhSMWNtNGdablZ1WTNScGIyNG9LWHNnY21WMGRYSnVJR1p1TG1Gd2NHeDVLRzFsTENCaGNtZDFiV1Z1ZEhNcE95QjlPeUI5TzF4dVhHNW9ZWEJ3Wlc1eklEMGdjbVZ4ZFdseVpTZ25hR0Z3Y0dWdWN5Y3BPMXh1WEc1VmRHbHNjeUE5SUhKbGNYVnBjbVVvSnk0dmRYUnBiSE1uS1R0Y2JseHVVMlZ4ZFdWdVkyVk1iMkZrWlhJZ1BTQnlaWEYxYVhKbEtDY3VMMnh2WVdSbGNpY3BPMXh1WEc1VFpYRjFaVzVqWlZCc1lYbGxjaUE5SUhKbGNYVnBjbVVvSnk0dmNHeGhlV1Z5SnlrN1hHNWNibTF2WkhWc1pTNWxlSEJ2Y25SeklEMGdkMmx1Wkc5M0xsWnBiV0ZuWlNBOUlGWnBiV0ZuWlNBOUlDaG1kVzVqZEdsdmJpZ3BJSHRjYmlBZ1puVnVZM1JwYjI0Z1ZtbHRZV2RsS0c5d2RHbHZibk1wSUh0Y2JpQWdJQ0JwWmlBb2IzQjBhVzl1Y3lBOVBTQnVkV3hzS1NCN1hHNGdJQ0FnSUNCdmNIUnBiMjV6SUQwZ2UzMDdYRzRnSUNBZ2ZWeHVJQ0FnSUhSb2FYTXVZblZtWm1WeVgyTnZiWEJzWlhSbElEMGdZbWx1WkNoMGFHbHpMbUoxWm1abGNsOWpiMjF3YkdWMFpTd2dkR2hwY3lrN1hHNGdJQ0FnZEdocGN5NTFjR1JoZEdWZlluVm1abVZ5SUQwZ1ltbHVaQ2gwYUdsekxuVndaR0YwWlY5aWRXWm1aWElzSUhSb2FYTXBPMXh1SUNBZ0lIUm9hWE11WkdGMFlWOXNiMkZrWldRZ1BTQmlhVzVrS0hSb2FYTXVaR0YwWVY5c2IyRmtaV1FzSUhSb2FYTXBPMXh1SUNBZ0lHaGhjSEJsYm5Nb2RHaHBjeWs3WEc0Z0lDQWdkR2hwY3k1dmNIUnBiMjV6SUQwZ2UxeHVJQ0FnSUNBZ0oyVnNaVzFsYm5Rbk9pQnVkV3hzTEZ4dUlDQWdJQ0FnSjJGMWRHOXdiR0Y1SnpvZ2RISjFaU3hjYmlBZ0lDQWdJQ2RtZFd4c2MyTnlaV1Z1SnpvZ1ptRnNjMlVzWEc0Z0lDQWdJQ0FuWW5WbVptVnlYM0JsY21ObGJuUW5PaUF3TGpFc1hHNGdJQ0FnSUNBbmRIbHdaU2M2SUNkMmFXUmxieWRjYmlBZ0lDQjlPMXh1SUNBZ0lGVjBhV3h6TG0xbGNtZGxLSFJvYVhNdWIzQjBhVzl1Y3l3Z2IzQjBhVzl1Y3lrN1hHNGdJQ0FnZEdocGN5NXZjSFJwYjI1ekxtVnNaVzFsYm5RZ1BTQmtiMk4xYldWdWRDNW5aWFJGYkdWdFpXNTBRbmxKWkNoMGFHbHpMbTl3ZEdsdmJuTXVaV3hsYldWdWRDazdYRzRnSUNBZ2RHaHBjeTV3YkdGNVpYSWdQU0J1WlhjZ1UyVnhkV1Z1WTJWUWJHRjVaWElvZEdocGN5NXZjSFJwYjI1ekxtVnNaVzFsYm5RcE8xeHVJQ0FnSUhSb2FYTXViVzlrWlhNZ1BTQnlaWEYxYVhKbEtDY3VMMjF2WkdWekp5azdYRzRnSUNBZ2RHaHBjeTVzYjJGa1pYSWdQU0J1WlhjZ1UyVnhkV1Z1WTJWTWIyRmtaWEk3WEc0Z0lIMWNibHh1SUNCV2FXMWhaMlV1Y0hKdmRHOTBlWEJsTG14dllXUWdQU0JtZFc1amRHbHZiaWhtYVd4bEtTQjdYRzRnSUNBZ2RHaHBjeTVzYjJGa1pYSXViMjRvSjJKMVptWmxjanAxY0dSaGRHVW5MQ0IwYUdsekxuVndaR0YwWlY5aWRXWm1aWElwTzF4dUlDQWdJSFJvYVhNdWJHOWhaR1Z5TG05dVkyVW9KMkoxWm1abGNqcGpiMjF3YkdWMFpTY3NJSFJvYVhNdVluVm1abVZ5WDJOdmJYQnNaWFJsS1R0Y2JpQWdJQ0IwYUdsekxteHZZV1JsY2k1dmJtTmxLQ2RrWVhSaE9teHZZV1JsWkNjc0lIUm9hWE11WkdGMFlWOXNiMkZrWldRcE8xeHVJQ0FnSUhKbGRIVnliaUIwYUdsekxteHZZV1JsY2k1c2IyRmtLR1pwYkdVcE8xeHVJQ0I5TzF4dVhHNGdJRlpwYldGblpTNXdjbTkwYjNSNWNHVXVjMlYwWDIxdlpHVWdQU0JtZFc1amRHbHZiaWh0YjJSbEtTQjdYRzRnSUNBZ2RHaHBjeTV0YjJSbElEMGdiVzlrWlR0Y2JpQWdJQ0J5WlhSMWNtNGdkR2hwY3k1d2JHRjVaWEl1YzJWMFgyMXZaR1VvZEdocGN5NXRiMlJsS1R0Y2JpQWdmVHRjYmx4dUlDQldhVzFoWjJVdWNISnZkRzkwZVhCbExtUmhkR0ZmYkc5aFpHVmtJRDBnWm5WdVkzUnBiMjRvS1NCN1hHNGdJQ0FnZEdocGN5NXdiR0Y1WlhJdVpuSmhiV1ZmZDJsa2RHZ2dQU0IwYUdsekxteHZZV1JsY2k1a1lYUmhMbmRwWkhSb08xeHVJQ0FnSUhSb2FYTXVjR3hoZVdWeUxtWnlZVzFsWDJobGFXZG9kQ0E5SUhSb2FYTXViRzloWkdWeUxtUmhkR0V1YUdWcFoyaDBPMXh1SUNBZ0lIUm9hWE11Y0d4aGVXVnlMbk5sZEY5emFYcGxLSFJvYVhNdWJHOWhaR1Z5TG1SaGRHRXVkMmxrZEdnc0lIUm9hWE11Ykc5aFpHVnlMbVJoZEdFdWFHVnBaMmgwS1R0Y2JpQWdJQ0JwWmlBb2RHaHBjeTV2Y0hScGIyNXpMbVoxYkd4elkzSmxaVzRwSUh0Y2JpQWdJQ0FnSUhSb2FYTXVjR3hoZVdWeUxtVnVZV0pzWlY5bWRXeHNjMk55WldWdVgzSmxjMmw2WlNncE8xeHVJQ0FnSUgxY2JseHVJQ0FnSUM4cVhHNGdJQ0FnWEhSY2RGQnNZWGtnZEdobElHMXZaR1VnWVdaMFpYSWdkR2hsSUdacGNuTjBJSEJoWTJ0eklHaGhkbVVnYkc5aFpHVmtYRzRnSUNBZ0lDb3ZYRzRnSUNBZ2NtVjBkWEp1SUhSb2FYTXViVzlrWlM1MGIzUmhiRjltY21GdFpYTWdQU0IwYUdsekxteHZZV1JsY2k1a1lYUmhMblJ2ZEdGc1gyWnlZVzFsY3p0Y2JpQWdmVHRjYmx4dVhHNGdJQzhxWEc0Z0lGeDBWWEJrWVhSbElIUm9aU0JwYldGblpYTWdZblZtWm1WeVhHNGdJQ0FxTDF4dVhHNGdJRlpwYldGblpTNXdjbTkwYjNSNWNHVXVkWEJrWVhSbFgySjFabVpsY2lBOUlHWjFibU4wYVc5dUtHbHRZV2RsY3lrZ2UxeHVJQ0FnSUhSb2FYTXVjR3hoZVdWeUxuVndaR0YwWlY5aWRXWm1aWElvYVcxaFoyVnpLVHRjYmlBZ0lDQnBaaUFvZEdocGN5NXZjSFJwYjI1ekxuUjVjR1VnUFQwOUlDZDJhV1JsYnljcElIdGNiaUFnSUNBZ0lHbG1JQ2gwYUdsekxtMXZaR1V1Y0d4aGVXbHVaeUE5UFQwZ1ptRnNjMlVnSmlZZ2RHaHBjeTV2Y0hScGIyNXpMbUYxZEc5d2JHRjVJQ1ltSUhSb2FYTXViRzloWkdWeUxuQmxjbU5sYm5SZmJHOWhaR1ZrSUQ0OUlIUm9hWE11YjNCMGFXOXVjeTVpZFdabVpYSmZjR1Z5WTJWdWRDa2dlMXh1SUNBZ0lDQWdJQ0IwYUdsekxtMXZaR1V1Y0d4aGVTaDBhR2x6TG14dllXUmxjaTVrWVhSaExtUjFjbUYwYVc5dUtUdGNiaUFnSUNBZ0lIMWNiaUFnSUNBZ0lHbG1JQ2gwYUdsekxtMXZaR1V1Y0dGMWMyVXBJSHRjYmlBZ0lDQWdJQ0FnY21WMGRYSnVJSFJvYVhNdWJXOWtaUzV5WlhOMWJXVW9LVHRjYmlBZ0lDQWdJSDFjYmlBZ0lDQjlYRzRnSUgwN1hHNWNibHh1SUNBdktseHVJQ0JjZEVGbWRHVnlJR0ZzYkNCMGFHVWdjR0ZqYTNNZ2FHRjJaU0JzYjJGa1pXUmNiaUFnSUNvdlhHNWNiaUFnVm1sdFlXZGxMbkJ5YjNSdmRIbHdaUzVpZFdabVpYSmZZMjl0Y0d4bGRHVWdQU0JtZFc1amRHbHZiaWdwSUh0Y2JpQWdJQ0IwYUdsekxteHZZV1JsY2k1dlptWW9KMnh2WVdSbFpDY3BPMXh1SUNBZ0lIUm9hWE11Ykc5aFpHVnlMbTltWmlnblluVm1abVZ5T25Wd1pHRjBaU2NzSUhSb2FYTXVkWEJrWVhSbFgySjFabVpsY2lrN1hHNGdJQ0FnYVdZZ0tIUm9hWE11YjNCMGFXOXVjeTUwZVhCbElEMDlQU0FuZG1sa1pXOG5LU0I3WEc0Z0lDQWdJQ0JwWmlBb2RHaHBjeTV0YjJSbExuQnNZWGxwYm1jZ1BUMDlJR1poYkhObElDWW1JSFJvYVhNdWIzQjBhVzl1Y3k1aGRYUnZjR3hoZVNBbUppQjBhR2x6TG14dllXUmxjaTV3WlhKalpXNTBYMnh2WVdSbFpDQStQU0IwYUdsekxtOXdkR2x2Ym5NdVluVm1abVZ5WDNCbGNtTmxiblFwSUh0Y2JpQWdJQ0FnSUNBZ2RHaHBjeTV0YjJSbExuQnNZWGtvZEdocGN5NXNiMkZrWlhJdVpHRjBZUzVrZFhKaGRHbHZiaWs3WEc0Z0lDQWdJQ0I5WEc0Z0lDQWdmVnh1SUNBZ0lISmxkSFZ5YmlCMGFHbHpMbVZ0YVhRb0oyeHZZV1JsWkNjcE8xeHVJQ0I5TzF4dVhHNGdJRlpwYldGblpTNXdjbTkwYjNSNWNHVXVjR3hoZVNBOUlHWjFibU4wYVc5dUtDa2dlMXh1SUNBZ0lISmxkSFZ5YmlCMGFHbHpMbTF2WkdVdWNHeGhlU2dwTzF4dUlDQjlPMXh1WEc0Z0lISmxkSFZ5YmlCV2FXMWhaMlU3WEc1Y2JuMHBLQ2s3WEc0aVhYMD0iXX0=
