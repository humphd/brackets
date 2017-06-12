/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define */
define(function (require, exports, module) {
    "use strict";

    var Content = require("filesystem/impls/filer/lib/content");
    var Path = require("filesystem/impls/filer/FilerUtils").Path;
    var Buffer = require("filesystem/impls/filer/FilerUtils").Buffer;
    var decodePath = require("filesystem/impls/filer/FilerUtils").decodePath;
    var base64ToBuffer = require("filesystem/impls/filer/FilerUtils").base64ToBuffer;

    var pica = require("Pica")();

    // 1KB
    var KB = 1024;
    // Ideal size for images
    var TARGET_SIZE_KB = 250 * KB;
    // Resize error tolerance
    var TOLERANCE_KB = 20 * KB;
    // Max number of resize passes we allow
    var MAX_RESIZE_PASSES = 5;


    function ImageResizer(path, data) {
        this.path = decodePath(path);
        this.type = Content.mimeFromExt(Path.extname(this.path));
        this.size = data.length;
        this.blob = new Blob([data], {type: this.type});
        this.url = URL.createObjectURL(this.blob);
        this.canvas = document.createElement('canvas');
    }
    ImageResizer.prototype.cleanup = function() {
        URL.revokeObjectURL(this.url);
    };
    ImageResizer.prototype.resizedToBuffer = function(callback) {
        var canvas = this.canvas;

        // If possible, use native methods to read out canvas data
        if (canvas.toBlob) {
            canvas.toBlob(function(blob) {
                var fileReader = new FileReader();
                fileReader.onload = function() {
                    var buffer = new Buffer(this.result);
                    callback(null, buffer);
                };
                fileReader.onerror = function() {
                    callback(new Error("unable to read data"));
                };
                fileReader.readAsArrayBuffer(blob);
            });
        }
        // Fallback for browsers without necessary native methods
        else {
            var base64Str = canvas.toDataURL(self.type).split(',')[1];
            var buffer = base64ToBuffer(base64Str);
            callback(null, buffer);
        }
    };
    ImageResizer.prototype.resize = function(callback) {
        var self = this;
        var buffer;
        var passes = 0;
        // do a "best guess" initial scale
        var scale = Math.sqrt(TARGET_SIZE_KB / self.size);
        var step = scale / 2;

        function finish(err, buffer) {
            self.cleanup();
            callback(err, buffer);
        }

        function resizePass() {
            console.log("resizePass", passes, "scale", scale);

            if(passes++ > MAX_RESIZE_PASSES) {
                return finish(null, buffer);
            }

            self.canvas.width = img.width * scale;
            self.canvas.height = img.height * scale;

            console.log("width", self.canvas.width, "height", self.canvas.height);

            pica.resize(img, self.canvas)
            .then(function() {
                self.resizedToBuffer(function(err, buffer) {
                    if(err) {
                        return finish(err);
                    }

                    // Too big?
                    if(buffer.length > TARGET_SIZE_KB + TOLERANCE_KB) {
                        console.log("Resized image too big", buffer.length);
                        scale = scale - step;
                        step /= 2;
                        resizePass();
                    }
                    // Smaller than necessary?
                    else if(buffer.length < TARGET_SIZE_KB - TOLERANCE_KB) {
                        console.log("Resized image too small", buffer.length);
                        scale = scale + step;
                        step /= 2;
                        resizePass();
                    } else {
                        finish(null, buffer);
                    }
                });
            })
            .catch(finish);
        }

        var img = new Image();
        img.onload = resizePass;
        img.onerror = function() {
            finish(new Error("Unable to load image for resizing"));
        };
        img.src = self.url;
    };

    /**
     * Resize an image and write back to the filesystem
     */
    function resize(path, data, callback) {
        var resizer = new ImageResizer(path, data);
        resizer.resize(callback);
    }

    /**
     * Test if image data size is too big (250K)
     */
    function isImageTooLarge(size) {
        return size > TARGET_SIZE_KB;
    }

    exports.resize = resize;
    exports.isImageTooLarge = isImageTooLarge;
});
