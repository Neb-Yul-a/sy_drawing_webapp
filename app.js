/*
 * Kids Drawing App - Main Application
 * Compatible with iOS 9.3.6 (Safari 9.1)
 * Uses touch events, ES5-safe patterns
 */
(function () {
    'use strict';

    /* ===== Canvas ellipse polyfill for iOS 9 ===== */
    if (!CanvasRenderingContext2D.prototype.ellipse) {
        CanvasRenderingContext2D.prototype.ellipse = function (cx, cy, rx, ry, rotation, startAngle, endAngle, ccw) {
            this.save();
            this.translate(cx, cy);
            this.rotate(rotation || 0);
            this.scale(rx, ry);
            this.arc(0, 0, 1, startAngle, endAngle, ccw);
            this.restore();
        };
    }

    /* ===== Configuration ===== */
    var COLORS = [
        '#000000', '#FFFFFF', '#FF1744', '#FF6D00', '#FFD600',
        '#00E676', '#2979FF', '#651FFF', '#FF4081', '#8D6E63',
        '#00BCD4', '#76FF03', '#FF3D00', '#FFAB00'
    ];
    var MAX_HISTORY = 3;

    /* ===== Application State ===== */
    var state = {
        tool: 'pen',
        penType: 'normal',
        stampType: 'star',
        color: '#000000',
        size: 12,
        drawing: false,
        lastX: 0,
        lastY: 0,
        hue: 0,
        history: [],
        historyIndex: -1,
        templateFunc: null,
        templateName: null,
        templateMode: 'trace'  // 'trace' = 따라그리기, 'color' = 색칠하기
    };

    /* Guard: prevent touch pass-through when modals close */
    var modalClosedAt = 0;

    /* Cached canvas position (avoid getBoundingClientRect per touch) */
    var canvasRect = { left: 0, top: 0 };

    /* rAF throttle for drawing */
    var pendingMove = null;
    var rafId = 0;

    /* ===== DOM References ===== */
    var canvas, ctx;
    var overlayCanvas, overlayCtx;
    var penTypesBar, stampTypesBar;
    var templateModal, saveModal, clearModal;
    var templateModeBar;

    /* ===== Initialization ===== */
    function init() {
        canvas = document.getElementById('canvas');
        ctx = canvas.getContext('2d');
        overlayCanvas = document.getElementById('canvas-overlay');
        overlayCtx = overlayCanvas.getContext('2d');
        penTypesBar = document.getElementById('pen-types');
        stampTypesBar = document.getElementById('stamp-types');
        templateModeBar = document.getElementById('template-mode-bar');
        templateModal = document.getElementById('template-modal');
        saveModal = document.getElementById('save-modal');
        clearModal = document.getElementById('clear-modal');

        buildColorPalette();
        buildTemplateGrid();
        bindEvents();

        // Delay canvas sizing to ensure layout is fully settled
        setTimeout(function () {
            sizeCanvas();
            updateCanvasRect();
            clearToWhite();
            pushHistory();
        }, 100);
    }

    function sizeCanvas() {
        // Calculate canvas size from known layout: toolbar(52px) top, bottom-bar(76px) bottom
        var w = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
        var h = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
        var topOffset = 52;
        var bottomOffset = 76;
        var canvasW = w;
        var canvasH = h - topOffset - bottomOffset;
        if (canvasH < 100) canvasH = 100;

        canvas.style.top = topOffset + 'px';
        canvas.style.left = '0';
        canvas.style.width = canvasW + 'px';
        canvas.style.height = canvasH + 'px';
        canvas.width = canvasW;
        canvas.height = canvasH;

        overlayCanvas.style.top = topOffset + 'px';
        overlayCanvas.style.left = '0';
        overlayCanvas.style.width = canvasW + 'px';
        overlayCanvas.style.height = canvasH + 'px';
        overlayCanvas.width = canvasW;
        overlayCanvas.height = canvasH;
    }

    /* ===== Color Palette ===== */
    function buildColorPalette() {
        var container = document.getElementById('color-palette');
        for (var i = 0; i < COLORS.length; i++) {
            var btn = document.createElement('button');
            btn.className = 'color-btn';
            if (COLORS[i] === state.color) btn.className += ' active';
            if (COLORS[i] === '#FFFFFF') btn.className += ' white-color';
            btn.style.backgroundColor = COLORS[i];
            btn.setAttribute('data-color', COLORS[i]);
            container.appendChild(btn);
        }
    }

    /* ===== Event Binding ===== */
    function bindEvents() {
        // Prevent rubber-band scrolling & pinch zoom globally
        document.addEventListener('touchmove', function (e) {
            var t = e.target;
            while (t && t !== document) {
                if (t.classList && t.classList.contains('modal-content')) return;
                t = t.parentNode;
            }
            e.preventDefault();
        }, false);

        // Prevent double-tap zoom on body
        var lastTouchEndTime = 0;
        document.addEventListener('touchend', function (e) {
            var now = Date.now();
            if (now - lastTouchEndTime < 300) {
                e.preventDefault();
            }
            lastTouchEndTime = now;
        }, false);

        // Canvas drawing — touch
        canvas.addEventListener('touchstart', onTouchStart, false);
        canvas.addEventListener('touchmove', onTouchMove, false);
        canvas.addEventListener('touchend', onTouchEnd, false);
        canvas.addEventListener('touchcancel', onTouchEnd, false);

        // Canvas drawing — mouse (for desktop testing)
        canvas.addEventListener('mousedown', onMouseDown, false);
        canvas.addEventListener('mousemove', onMouseMove, false);
        canvas.addEventListener('mouseup', onMouseUp, false);
        canvas.addEventListener('mouseleave', onMouseUp, false);

        // Toolbar buttons
        bindButtonGroup('#toolbar .tool-btn', onToolTap);
        bindButtonGroup('#pen-types .sub-btn', onPenTypeTap);
        bindButtonGroup('#stamp-types .sub-btn', onStampTypeTap);
        bindButtonGroup('#size-selector .size-btn', onSizeTap);

        // Color palette (event delegation)
        addTap(document.getElementById('color-palette'), onColorTap);

        // Modal close buttons
        addTap(document.getElementById('close-template'), function () {
            templateModal.classList.add('hidden');
        });
        addTap(document.getElementById('close-save'), function () {
            saveModal.classList.add('hidden');
        });

        // Modal overlay close
        var overlays = document.querySelectorAll('.modal-overlay');
        for (var i = 0; i < overlays.length; i++) {
            (function (overlay) {
                addTap(overlay, function () {
                    overlay.parentNode.classList.add('hidden');
                    modalClosedAt = Date.now();
                });
            })(overlays[i]);
        }

        // Clear confirm buttons
        addTap(document.getElementById('clear-yes'), function () {
            clearModal.classList.add('hidden');
            modalClosedAt = Date.now();
            clearToWhite();
            pushHistory();
        });
        addTap(document.getElementById('clear-no'), function () {
            clearModal.classList.add('hidden');
            modalClosedAt = Date.now();
        });

        // Template mode toggle
        addTap(document.getElementById('mode-trace'), function () {
            state.templateMode = 'trace';
            updateTemplateModeUI();
            syncOverlay();
            // Redraw template on main canvas for tracing
            if (state.templateFunc) {
                state.templateFunc(ctx, canvas.width, canvas.height);
                pushHistory();
            }
        });
        addTap(document.getElementById('mode-color'), function () {
            state.templateMode = 'color';
            updateTemplateModeUI();
            syncOverlay();
        });

        // Handle orientation change / resize
        window.addEventListener('resize', onResize, false);
    }

    /* Utility: bind touch+click to a group of buttons */
    function bindButtonGroup(selector, handler) {
        var btns = document.querySelectorAll(selector);
        for (var i = 0; i < btns.length; i++) {
            addTap(btns[i], handler);
        }
    }

    /* Utility: add touch-first tap handler that deduplicates touch+click */
    var _tapTimers = [];
    function addTap(el, handler) {
        var lastTouch = 0;
        el.addEventListener('touchstart', function (e) {
            lastTouch = Date.now();
            handler.call(this, e);
        }, false);
        el.addEventListener('click', function (e) {
            if (Date.now() - lastTouch < 500) return;
            handler.call(this, e);
        }, false);
    }

    /* ===== Canvas Resize ===== */
    var resizeTimer = null;
    function onResize() {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            var imgData = null;
            try {
                imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            } catch (e) { /* ignore */ }
            sizeCanvas();
            updateCanvasRect();
            clearToWhite();
            if (imgData) {
                ctx.putImageData(imgData, 0, 0);
            }
            syncOverlay();
        }, 200);
    }

    /* ===== Touch / Mouse Handlers ===== */
    function updateCanvasRect() {
        var rect = canvas.getBoundingClientRect();
        canvasRect.left = rect.left;
        canvasRect.top = rect.top;
    }

    function getCanvasPos(clientX, clientY) {
        return {
            x: clientX - canvasRect.left,
            y: clientY - canvasRect.top
        };
    }

    function onTouchStart(e) {
        e.preventDefault();
        if (e.touches.length !== 1) return;
        if (Date.now() - modalClosedAt < 400) return;
        var p = getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
        beginStroke(p.x, p.y);
    }

    function onTouchMove(e) {
        e.preventDefault();
        if (!state.drawing) return;
        if (e.touches.length !== 1) return;
        pendingMove = { cx: e.touches[0].clientX, cy: e.touches[0].clientY };
        if (!rafId) {
            rafId = requestAnimationFrame(flushMove);
        }
    }

    function flushMove() {
        rafId = 0;
        if (!state.drawing || !pendingMove) return;
        var p = getCanvasPos(pendingMove.cx, pendingMove.cy);
        pendingMove = null;
        continueStroke(p.x, p.y);
    }

    function onTouchEnd(e) {
        e.preventDefault();
        finishStroke();
    }

    function onMouseDown(e) {
        var p = getCanvasPos(e.clientX, e.clientY);
        beginStroke(p.x, p.y);
    }

    function onMouseMove(e) {
        if (!state.drawing) return;
        pendingMove = { cx: e.clientX, cy: e.clientY };
        if (!rafId) {
            rafId = requestAnimationFrame(flushMove);
        }
    }

    function onMouseUp() {
        finishStroke();
    }

    /* ===== Drawing Logic ===== */
    function beginStroke(x, y) {
        // Instant tools: fill and stamp
        if (state.tool === 'fill') {
            floodFill(Math.round(x), Math.round(y), state.color);
            pushHistory();
            return;
        }
        if (state.tool === 'stamp') {
            drawStamp(x, y);
            pushHistory();
            return;
        }
        state.drawing = true;
        state.lastX = x;
        state.lastY = y;

        // Draw initial dot
        if (state.tool === 'pen') {
            drawDot(x, y);
        } else if (state.tool === 'eraser') {
            eraseAt(x, y);
        }
    }

    function continueStroke(x, y) {
        if (state.tool === 'pen') {
            drawLine(state.lastX, state.lastY, x, y);
        } else if (state.tool === 'eraser') {
            eraseAt(x, y);
        }
        state.lastX = x;
        state.lastY = y;
    }

    function finishStroke() {
        if (state.drawing) {
            state.drawing = false;
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = 0;
            }
            if (pendingMove) {
                var p = getCanvasPos(pendingMove.cx, pendingMove.cy);
                continueStroke(p.x, p.y);
                pendingMove = null;
            }
            pushHistory();
        }
    }

    /* Sync template overlay canvas */
    function syncOverlay() {
        if (state.templateMode === 'color' && state.templateFunc) {
            overlayCanvas.style.display = 'block';
            // Draw template on a temp white-background canvas (same rendering as trace mode)
            var tmp = document.createElement('canvas');
            tmp.width = overlayCanvas.width;
            tmp.height = overlayCanvas.height;
            var tmpCtx = tmp.getContext('2d');
            tmpCtx.lineJoin = 'round';
            tmpCtx.lineCap = 'round';
            tmpCtx.fillStyle = '#FFFFFF';
            tmpCtx.fillRect(0, 0, tmp.width, tmp.height);
            state.templateFunc(tmpCtx, tmp.width, tmp.height);

            // Extract lines: white/light → transparent, dark → fully opaque
            var imgData = tmpCtx.getImageData(0, 0, tmp.width, tmp.height);
            var d = imgData.data;
            var len = d.length;
            for (var i = 0; i < len; i += 4) {
                // Fast integer brightness approximation (avoid floats)
                var brightness = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
                if (brightness > 220) {
                    d[i + 3] = 0;
                } else if (brightness > 180) {
                    d[i] = d[i + 1] = d[i + 2] = 0;
                    d[i + 3] = (220 - brightness) * 6;  // ~255/40 ≈ 6.375
                } else {
                    d[i] = d[i + 1] = d[i + 2] = 0;
                    d[i + 3] = 255;
                }
            }

            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            overlayCtx.putImageData(imgData, 0, 0);
        } else {
            overlayCanvas.style.display = 'none';
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
    }

    /* ===== Drawing Primitives ===== */
    function drawDot(x, y) {
        var c = state.penType === 'rainbow' ? rainbowColor() : state.color;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, state.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
    }

    function drawLine(x1, y1, x2, y2) {
        switch (state.penType) {
            case 'marker': drawMarkerLine(x1, y1, x2, y2); break;
            case 'crayon': drawCrayonLine(x1, y1, x2, y2); break;
            case 'rainbow': drawRainbowLine(x1, y1, x2, y2); break;
            case 'sparkle': drawSparkleLine(x1, y1, x2, y2); break;
            default: drawNormalLine(x1, y1, x2, y2); break;
        }
    }

    function drawNormalLine(x1, y1, x2, y2) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = state.color;
        ctx.lineWidth = state.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
    }

    function drawMarkerLine(x1, y1, x2, y2) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = state.color;
        ctx.lineWidth = state.size * 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    function drawCrayonLine(x1, y1, x2, y2) {
        var dx = x2 - x1, dy = y2 - y1;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var steps = Math.max(1, Math.floor(dist / 2));
        ctx.fillStyle = state.color;

        for (var i = 0; i < steps; i++) {
            var t = i / steps;
            var cx = x1 + dx * t;
            var cy = y1 + dy * t;
            for (var j = 0; j < 2; j++) {
                var ox = (Math.random() - 0.5) * state.size * 0.9;
                var oy = (Math.random() - 0.5) * state.size * 0.9;
                ctx.globalAlpha = 0.3 + Math.random() * 0.35;
                ctx.beginPath();
                ctx.arc(cx + ox, cy + oy, state.size * 0.3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawRainbowLine(x1, y1, x2, y2) {
        state.hue = (state.hue + 3) % 360;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = 'hsl(' + state.hue + ',100%,50%)';
        ctx.lineWidth = state.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
    }

    function drawSparkleLine(x1, y1, x2, y2) {
        // Thin base line
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = state.color;
        ctx.lineWidth = state.size * 0.4;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Sparkle particles
        var dx = x2 - x1, dy = y2 - y1;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var count = Math.max(1, Math.floor(dist / 6));
        for (var i = 0; i < count; i++) {
            var t = Math.random();
            var sx = x1 + dx * t + (Math.random() - 0.5) * state.size * 3;
            var sy = y1 + dy * t + (Math.random() - 0.5) * state.size * 3;
            var sr = Math.random() * 3 + 0.5;
            ctx.beginPath();
            ctx.arc(sx, sy, sr, 0, Math.PI * 2);
            ctx.fillStyle = 'hsl(' + Math.floor(Math.random() * 360) + ',100%,70%)';
            ctx.fill();
        }
    }

    function rainbowColor() {
        state.hue = (state.hue + 5) % 360;
        return 'hsl(' + state.hue + ',100%,50%)';
    }

    function eraseAt(x, y) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, state.size * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
    }

    /* ===== Flood Fill (scanline optimized) ===== */
    function floodFill(sx, sy, fillHex) {
        var w = canvas.width;
        var h = canvas.height;
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

        var imageData = ctx.getImageData(0, 0, w, h);
        var data = imageData.data;
        var fill = hexToRgb(fillHex);
        if (!fill) return;

        var idx = (sy * w + sx) * 4;
        var sr = data[idx], sg = data[idx + 1], sb = data[idx + 2], sa = data[idx + 3];

        // If target color is already the fill color, skip
        if (sr === fill.r && sg === fill.g && sb === fill.b && sa === 255) return;

        var tol = 32;
        var visited = new Uint8Array(w * h);

        function match(pos) {
            var i = pos * 4;
            return !visited[pos] &&
                Math.abs(data[i] - sr) <= tol && Math.abs(data[i + 1] - sg) <= tol &&
                Math.abs(data[i + 2] - sb) <= tol && Math.abs(data[i + 3] - sa) <= tol;
        }

        var stack = [sx, sy];

        while (stack.length > 0) {
            var cy = stack.pop();
            var cx = stack.pop();
            var pos = cy * w + cx;

            if (visited[pos] || !match(pos)) continue;

            // Find left boundary of this span
            var lx = cx;
            while (lx > 0 && match(cy * w + lx - 1)) lx--;

            // Fill rightward from left boundary
            var rx = lx;
            var spanUp = false;
            var spanDown = false;

            while (rx < w) {
                var rpos = cy * w + rx;
                if (!match(rpos)) break;

                visited[rpos] = 1;
                var ri = rpos * 4;
                data[ri] = fill.r;
                data[ri + 1] = fill.g;
                data[ri + 2] = fill.b;
                data[ri + 3] = 255;

                // Check row above
                if (cy > 0) {
                    var aMatch = match((cy - 1) * w + rx);
                    if (aMatch && !spanUp) {
                        stack.push(rx, cy - 1);
                        spanUp = true;
                    } else if (!aMatch) {
                        spanUp = false;
                    }
                }

                // Check row below
                if (cy < h - 1) {
                    var bMatch = match((cy + 1) * w + rx);
                    if (bMatch && !spanDown) {
                        stack.push(rx, cy + 1);
                        spanDown = true;
                    } else if (!bMatch) {
                        spanDown = false;
                    }
                }

                rx++;
            }
        }

        ctx.putImageData(imageData, 0, 0);
    }

    function hexToRgb(hex) {
        var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
    }

    /* ===== Stamps ===== */
    function drawStamp(x, y) {
        var s = state.size * 3;
        ctx.save();
        ctx.globalAlpha = 1;
        switch (state.stampType) {
            case 'star': stampStar(x, y, s); break;
            case 'heart': stampHeart(x, y, s); break;
            case 'smiley': stampSmiley(x, y, s); break;
            case 'flower': stampFlower(x, y, s); break;
            case 'moon': stampMoon(x, y, s); break;
            case 'bear': stampBear(x, y, s); break;
            case 'mermaid': stampFish(x, y, s); break;
        }
        ctx.restore();
    }

    function stampStar(cx, cy, size) {
        var or_ = size / 2, ir = size / 4;
        ctx.fillStyle = state.color;
        ctx.beginPath();
        for (var i = 0; i < 10; i++) {
            var r = (i % 2 === 0) ? or_ : ir;
            var a = (Math.PI * i / 5) - Math.PI / 2;
            if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
    }

    function stampHeart(cx, cy, size) {
        var r = size / 2;
        ctx.fillStyle = state.color;
        ctx.beginPath();
        ctx.moveTo(cx, cy + r * 0.65);
        // Left side: bottom point → left bulge → top center
        ctx.bezierCurveTo(
            cx - r * 0.1, cy + r * 0.4,
            cx - r * 0.95, cy + r * 0.05,
            cx - r * 0.55, cy - r * 0.45
        );
        ctx.bezierCurveTo(
            cx - r * 0.35, cy - r * 0.7,
            cx - r * 0.05, cy - r * 0.6,
            cx, cy - r * 0.3
        );
        // Right side: top center → right bulge → bottom point
        ctx.bezierCurveTo(
            cx + r * 0.05, cy - r * 0.6,
            cx + r * 0.35, cy - r * 0.7,
            cx + r * 0.55, cy - r * 0.45
        );
        ctx.bezierCurveTo(
            cx + r * 0.95, cy + r * 0.05,
            cx + r * 0.1, cy + r * 0.4,
            cx, cy + r * 0.65
        );
        ctx.closePath();
        ctx.fill();
    }

    function stampSmiley(cx, cy, size) {
        var r = size / 2;
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Eyes
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(cx - r * 0.3, cy - r * 0.2, r * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + r * 0.3, cy - r * 0.2, r * 0.1, 0, Math.PI * 2);
        ctx.fill();
        // Smile
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.05, r * 0.42, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
    }

    function stampFlower(cx, cy, size) {
        var pr = size / 3;
        var petalColors = ['#FF6B6B', '#FF69B4', '#FF1493', '#FF6B6B', '#FF69B4'];
        for (var i = 0; i < 5; i++) {
            var a = (Math.PI * 2 * i / 5) - Math.PI / 2;
            var px = cx + Math.cos(a) * pr;
            var py = cy + Math.sin(a) * pr;
            ctx.fillStyle = petalColors[i];
            ctx.beginPath();
            ctx.arc(px, py, pr * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(cx, cy, pr * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }

    function stampMoon(cx, cy, size) {
        var r = size / 2;
        var d = r * 2 + 4;
        // Use offscreen canvas to compose crescent cleanly
        var off = document.createElement('canvas');
        off.width = d;
        off.height = d;
        var oc = off.getContext('2d');
        var ocx = d / 2;
        var ocy = d / 2;
        // Draw full circle
        oc.fillStyle = state.color;
        oc.beginPath();
        oc.arc(ocx, ocy, r, 0, Math.PI * 2);
        oc.fill();
        // Erase inner circle to create crescent
        oc.globalCompositeOperation = 'destination-out';
        oc.beginPath();
        oc.arc(ocx + r * 0.4, ocy - r * 0.1, r * 0.75, 0, Math.PI * 2);
        oc.fill();
        // Stamp onto main canvas
        ctx.drawImage(off, cx - d / 2, cy - d / 2);
    }

    function stampBear(cx, cy, size) {
        var r = size / 2;
        var headR = r * 0.65;
        var earR = r * 0.3;
        var earDist = headR * 0.7;
        var color = state.color === '#FFFFFF' ? '#8B4513' : state.color;
        // Ears
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx - earDist, cy - headR * 0.7, earR, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + earDist, cy - headR * 0.7, earR, 0, Math.PI * 2);
        ctx.fill();
        // Inner ears
        ctx.fillStyle = '#FFB6C1';
        ctx.beginPath();
        ctx.arc(cx - earDist, cy - headR * 0.7, earR * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + earDist, cy - headR * 0.7, earR * 0.55, 0, Math.PI * 2);
        ctx.fill();
        // Head
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, headR, 0, Math.PI * 2);
        ctx.fill();
        // Muzzle
        ctx.fillStyle = '#DEB887';
        ctx.beginPath();
        ctx.arc(cx, cy + headR * 0.25, headR * 0.4, 0, Math.PI * 2);
        ctx.fill();
        // Nose
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(cx, cy + headR * 0.1, headR * 0.12, 0, Math.PI * 2);
        ctx.fill();
        // Eyes
        ctx.beginPath();
        ctx.arc(cx - headR * 0.3, cy - headR * 0.15, headR * 0.09, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + headR * 0.3, cy - headR * 0.15, headR * 0.09, 0, Math.PI * 2);
        ctx.fill();
    }

    function stampFish(cx, cy, size) {
        var r = size / 2;
        var color = state.color === '#FFFFFF' ? '#FF8C00' : state.color;
        // Body (ellipse-like)
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.7, cy);
        ctx.quadraticCurveTo(cx - r * 0.7, cy - r * 0.5, cx - r * 0.1, cy - r * 0.5);
        ctx.quadraticCurveTo(cx + r * 0.5, cy - r * 0.5, cx + r * 0.55, cy);
        ctx.quadraticCurveTo(cx + r * 0.5, cy + r * 0.5, cx - r * 0.1, cy + r * 0.5);
        ctx.quadraticCurveTo(cx - r * 0.7, cy + r * 0.5, cx - r * 0.7, cy);
        ctx.closePath();
        ctx.fill();
        // Tail
        ctx.beginPath();
        ctx.moveTo(cx + r * 0.45, cy);
        ctx.lineTo(cx + r * 0.85, cy - r * 0.35);
        ctx.quadraticCurveTo(cx + r * 0.65, cy, cx + r * 0.85, cy + r * 0.35);
        ctx.closePath();
        ctx.fill();
        // Eye (white)
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(cx - r * 0.32, cy - r * 0.08, r * 0.14, 0, Math.PI * 2);
        ctx.fill();
        // Eye (pupil)
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(cx - r * 0.3, cy - r * 0.08, r * 0.07, 0, Math.PI * 2);
        ctx.fill();
        // Mouth / Smile — starts from near the nose tip
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(1.5, r * 0.04);
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.64, cy + r * 0.25);
        ctx.quadraticCurveTo(cx - r * 0.52, cy + r * 0.28, cx - r * 0.38, cy + r * 0.18);
        ctx.stroke();
    }

    /* ===== History (Undo) ===== */
    function pushHistory() {
        // Truncate future states
        if (state.historyIndex < state.history.length - 1) {
            state.history.length = state.historyIndex + 1;
        }
        try {
            state.history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
        } catch (e) {
            return;
        }
        if (state.history.length > MAX_HISTORY) {
            state.history.shift();
        }
        state.historyIndex = state.history.length - 1;
    }

    function undo() {
        if (state.historyIndex > 0) {
            state.historyIndex--;
            ctx.putImageData(state.history[state.historyIndex], 0, 0);
        }
    }

    function updateTemplateModeUI() {
        var traceBtn = document.getElementById('mode-trace');
        var colorBtn = document.getElementById('mode-color');
        if (state.templateMode === 'trace') {
            traceBtn.classList.add('active');
            colorBtn.classList.remove('active');
        } else {
            traceBtn.classList.remove('active');
            colorBtn.classList.add('active');
        }
    }

    function showTemplateModeBar(show) {
        if (show) {
            templateModeBar.classList.remove('hidden');
        } else {
            templateModeBar.classList.add('hidden');
        }
    }

    /* ===== Reset (full refresh) ===== */
    function doReset() {
        // Reset state
        state.tool = 'pen';
        state.penType = 'normal';
        state.stampType = 'star';
        state.color = '#000000';
        state.size = 12;
        state.drawing = false;
        state.hue = 0;
        state.history = [];
        state.historyIndex = -1;
        state.templateFunc = null;
        state.templateName = null;
        state.templateMode = 'trace';

        // Reset UI
        setActiveInGroup('#toolbar .tool-btn', document.querySelector('[data-tool="pen"]'));
        setActiveInGroup('#pen-types .sub-btn', document.querySelector('[data-pen="normal"]'));
        setActiveInGroup('#stamp-types .sub-btn', document.querySelector('[data-stamp="star"]'));
        setActiveInGroup('#size-selector .size-btn', document.querySelector('[data-size="12"]'));
        penTypesBar.classList.remove('hidden');
        stampTypesBar.classList.add('hidden');
        showTemplateModeBar(false);
        updateTemplateModeUI();
        syncOverlay();

        // Rebuild color palette active state
        var colorBtns = document.querySelectorAll('#color-palette .color-btn');
        for (var i = 0; i < colorBtns.length; i++) {
            colorBtns[i].classList.remove('active');
            if (colorBtns[i].getAttribute('data-color') === '#000000') {
                colorBtns[i].classList.add('active');
            }
        }

        // Clear canvas
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        pushHistory();
    }

    /* ===== Canvas Clear ===== */
    function clearToWhite() {
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // In trace mode, draw template on main canvas; in color mode, overlay handles it
        if (state.templateFunc && state.templateMode !== 'color') {
            ctx.save();
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            state.templateFunc(ctx, canvas.width, canvas.height);
            ctx.restore();
        }
    }

    /* ===== Toolbar Handlers ===== */
    function onToolTap(e) {
        e.preventDefault();
        e.stopPropagation();
        var btn = this;
        if (!btn.getAttribute) btn = e.currentTarget;
        var tool = btn.getAttribute('data-tool');
        if (!tool) return;

        // Action tools (no toggle)
        if (tool === 'undo') { undo(); return; }
        if (tool === 'clear') { clearModal.classList.remove('hidden'); return; }
        if (tool === 'template') { templateModal.classList.remove('hidden'); return; }
        if (tool === 'save') { showSaveDialog(); return; }
        if (tool === 'reset') { doReset(); return; }

        // Set active tool
        state.tool = tool;
        var allBtns = document.querySelectorAll('#toolbar .tool-btn');
        for (var i = 0; i < allBtns.length; i++) {
            allBtns[i].classList.remove('active');
        }
        btn.classList.add('active');

        // Sub toolbar visibility
        penTypesBar.classList.add('hidden');
        stampTypesBar.classList.add('hidden');
        templateModeBar.classList.add('hidden');
        if (tool === 'pen') penTypesBar.classList.remove('hidden');
        else if (tool === 'stamp') stampTypesBar.classList.remove('hidden');
        else if (state.templateFunc) templateModeBar.classList.remove('hidden');
    }

    function onPenTypeTap(e) {
        e.preventDefault();
        e.stopPropagation();
        var btn = this;
        if (!btn.getAttribute) btn = e.currentTarget;
        var pen = btn.getAttribute('data-pen');
        if (!pen) return;
        state.penType = pen;
        setActiveInGroup('#pen-types .sub-btn', btn);
    }

    function onStampTypeTap(e) {
        e.preventDefault();
        e.stopPropagation();
        var btn = this;
        if (!btn.getAttribute) btn = e.currentTarget;
        var stamp = btn.getAttribute('data-stamp');
        if (!stamp) return;
        state.stampType = stamp;
        setActiveInGroup('#stamp-types .sub-btn', btn);
    }

    function onColorTap(e) {
        e.preventDefault();
        var target = e.target;
        if (!target.classList.contains('color-btn')) return;
        state.color = target.getAttribute('data-color');
        setActiveInGroup('#color-palette .color-btn', target);
    }

    function onSizeTap(e) {
        e.preventDefault();
        e.stopPropagation();
        var btn = this;
        if (!btn.getAttribute) btn = e.currentTarget;
        var sz = btn.getAttribute('data-size');
        if (!sz) return;
        state.size = parseInt(sz, 10);
        setActiveInGroup('#size-selector .size-btn', btn);
    }

    function setActiveInGroup(selector, activeBtn) {
        var btns = document.querySelectorAll(selector);
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.remove('active');
        }
        activeBtn.classList.add('active');
    }

    /* ===== Save ===== */
    function showSaveDialog() {
        // Composite: main canvas + overlay (if visible)
        var tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = canvas.width;
        tmpCanvas.height = canvas.height;
        var tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.drawImage(canvas, 0, 0);
        if (overlayCanvas.style.display !== 'none') {
            tmpCtx.drawImage(overlayCanvas, 0, 0);
        }
        var dataURL = tmpCanvas.toDataURL('image/png');
        var preview = document.getElementById('save-preview');
        preview.innerHTML = '';
        var img = document.createElement('img');
        img.src = dataURL;
        img.alt = '내 그림';
        preview.appendChild(img);
        saveModal.classList.remove('hidden');
    }

    /* ===== Coloring Templates ===== */
    var templates = [
        { name: '고양이', fn: tmplCat },
        { name: '물고기', fn: tmplFish },
        { name: '집', fn: tmplHouse },
        { name: '꽃', fn: tmplFlower },
        { name: '나비', fn: tmplButterfly },
        { name: '별', fn: tmplStar },
        { name: '자동차', fn: tmplCar },
        { name: '나무', fn: tmplTree },
        { name: '로켓', fn: tmplRocket },
        { name: '무지개', fn: tmplRainbow }
    ];

    function buildTemplateGrid() {
        var grid = document.getElementById('template-grid');

        // Free draw option
        var free = document.createElement('div');
        free.className = 'template-item free-draw';
        free.innerHTML = '<span class="free-icon">✏️</span><span class="free-text">자유 그리기</span>';
        addTap(free, function () {
            state.templateFunc = null;
            state.templateName = null;
            showTemplateModeBar(false);
            syncOverlay();
            clearToWhite();
            pushHistory();
            templateModal.classList.add('hidden');
        });
        grid.appendChild(free);

        // Template items
        for (var i = 0; i < templates.length; i++) {
            (function (tmpl) {
                var item = document.createElement('div');
                item.className = 'template-item';

                // Preview canvas
                var pc = document.createElement('canvas');
                pc.width = 110;
                pc.height = 110;
                var pctx = pc.getContext('2d');
                pctx.fillStyle = '#FFFFFF';
                pctx.fillRect(0, 0, 110, 110);
                tmpl.fn(pctx, 110, 110);
                item.appendChild(pc);

                var label = document.createElement('div');
                label.className = 'template-name';
                label.textContent = tmpl.name;
                item.appendChild(label);

                addTap(item, function () {
                    state.templateFunc = tmpl.fn;
                    state.templateName = tmpl.name;
                    showTemplateModeBar(true);
                    clearToWhite();
                    syncOverlay();
                    pushHistory();
                    templateModal.classList.add('hidden');
                });

                grid.appendChild(item);
            })(templates[i]);
        }
    }

    /* ===== Template Drawing Functions ===== */
    function tmplCat(ctx, w, h) {
        var cx = w / 2, cy = h / 2;
        var s = Math.min(w, h) * 0.32;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(2, s * 0.04);
        ctx.fillStyle = '#FFFFFF';

        // Body
        ctx.beginPath();
        ctx.ellipse(cx, cy + s * 0.5, s * 0.5, s * 0.6, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Head
        ctx.beginPath();
        ctx.arc(cx, cy - s * 0.25, s * 0.4, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Left ear
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.3, cy - s * 0.5);
        ctx.lineTo(cx - s * 0.15, cy - s * 0.85);
        ctx.lineTo(cx, cy - s * 0.5);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Right ear
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 0.5);
        ctx.lineTo(cx + s * 0.15, cy - s * 0.85);
        ctx.lineTo(cx + s * 0.3, cy - s * 0.5);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Eyes
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(cx - s * 0.15, cy - s * 0.3, s * 0.05, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + s * 0.15, cy - s * 0.3, s * 0.05, 0, Math.PI * 2);
        ctx.fill();

        // Nose
        ctx.fillStyle = '#FF69B4';
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 0.18);
        ctx.lineTo(cx - s * 0.05, cy - s * 0.12);
        ctx.lineTo(cx + s * 0.05, cy - s * 0.12);
        ctx.closePath(); ctx.fill();

        // Whiskers
        ctx.strokeStyle = '#666';
        ctx.lineWidth = Math.max(1, s * 0.02);
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.1, cy - s * 0.15);
        ctx.lineTo(cx - s * 0.5, cy - s * 0.22);
        ctx.moveTo(cx - s * 0.1, cy - s * 0.1);
        ctx.lineTo(cx - s * 0.5, cy - s * 0.08);
        ctx.moveTo(cx + s * 0.1, cy - s * 0.15);
        ctx.lineTo(cx + s * 0.5, cy - s * 0.22);
        ctx.moveTo(cx + s * 0.1, cy - s * 0.1);
        ctx.lineTo(cx + s * 0.5, cy - s * 0.08);
        ctx.stroke();

        // Tail
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(2, s * 0.04);
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.4, cy + s * 0.8);
        ctx.quadraticCurveTo(cx + s * 0.9, cy + s * 0.3, cx + s * 0.7, cy);
        ctx.stroke();
    }

    function tmplFish(ctx, w, h) {
        var cx = w / 2, cy = h / 2;
        var s = Math.min(w, h) * 0.35;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(2, s * 0.04);
        ctx.fillStyle = '#FFFFFF';

        // Body
        ctx.beginPath();
        ctx.ellipse(cx - s * 0.1, cy, s * 0.65, s * 0.38, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Tail
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.45, cy);
        ctx.lineTo(cx + s * 0.9, cy - s * 0.4);
        ctx.lineTo(cx + s * 0.9, cy + s * 0.4);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Dorsal fin
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.15, cy - s * 0.35);
        ctx.lineTo(cx + s * 0.05, cy - s * 0.68);
        ctx.lineTo(cx + s * 0.2, cy - s * 0.35);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Eye
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(cx - s * 0.4, cy - s * 0.05, s * 0.07, 0, Math.PI * 2);
        ctx.fill();

        // Eye shine
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(cx - s * 0.38, cy - s * 0.07, s * 0.025, 0, Math.PI * 2);
        ctx.fill();

        // Mouth
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(1.5, s * 0.03);
        ctx.beginPath();
        ctx.arc(cx - s * 0.6, cy + s * 0.05, s * 0.1, -0.3, 0.3);
        ctx.stroke();

        // Scales (decorative lines)
        ctx.lineWidth = Math.max(1, s * 0.02);
        ctx.strokeStyle = '#999';
        for (var i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(cx - s * 0.1 + i * s * 0.15, cy, s * 0.15, -0.8, 0.8);
            ctx.stroke();
        }
    }

    function tmplHouse(ctx, w, h) {
        var cx = w / 2;
        var s = Math.min(w, h) * 0.32;
        var by = h * 0.72;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(2, s * 0.04);
        ctx.fillStyle = '#FFFFFF';

        // Wall
        ctx.beginPath();
        ctx.rect(cx - s * 0.65, by - s * 0.85, s * 1.3, s * 0.85);
        ctx.fill(); ctx.stroke();

        // Roof
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.8, by - s * 0.85);
        ctx.lineTo(cx, by - s * 1.5);
        ctx.lineTo(cx + s * 0.8, by - s * 0.85);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Door
        ctx.beginPath();
        ctx.rect(cx - s * 0.15, by - s * 0.5, s * 0.3, s * 0.5);
        ctx.fill(); ctx.stroke();

        // Doorknob
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(cx + s * 0.08, by - s * 0.25, s * 0.035, 0, Math.PI * 2);
        ctx.fill();

        // Windows
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.rect(cx - s * 0.5, by - s * 0.72, s * 0.22, s * 0.22);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.rect(cx + s * 0.28, by - s * 0.72, s * 0.22, s * 0.22);
        ctx.fill(); ctx.stroke();

        // Window cross lines
        ctx.lineWidth = Math.max(1, s * 0.02);
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.39, by - s * 0.72);
        ctx.lineTo(cx - s * 0.39, by - s * 0.5);
        ctx.moveTo(cx - s * 0.5, by - s * 0.61);
        ctx.lineTo(cx - s * 0.28, by - s * 0.61);
        ctx.moveTo(cx + s * 0.39, by - s * 0.72);
        ctx.lineTo(cx + s * 0.39, by - s * 0.5);
        ctx.moveTo(cx + s * 0.28, by - s * 0.61);
        ctx.lineTo(cx + s * 0.5, by - s * 0.61);
        ctx.stroke();

        // Chimney
        ctx.lineWidth = Math.max(2, s * 0.04);
        ctx.beginPath();
        ctx.rect(cx + s * 0.35, by - s * 1.4, s * 0.15, s * 0.35);
        ctx.fill(); ctx.stroke();
    }

    function tmplFlower(ctx, w, h) {
        var cx = w / 2, cy = h / 2;
        var s = Math.min(w, h) * 0.28;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(2, s * 0.05);
        ctx.fillStyle = '#FFFFFF';

        // Stem
        ctx.beginPath();
        ctx.moveTo(cx, cy + s * 0.4);
        ctx.lineTo(cx, cy + s * 1.4);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(2, s * 0.06);
        ctx.stroke();

        // Leaves
        ctx.fillStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(2, s * 0.05);
        ctx.strokeStyle = '#333';
        ctx.beginPath();
        ctx.ellipse(cx - s * 0.3, cy + s * 0.8, s * 0.22, s * 0.1, -0.5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx + s * 0.3, cy + s * 1.0, s * 0.22, s * 0.1, 0.5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Petals
        for (var i = 0; i < 6; i++) {
            var angle = (Math.PI * 2 * i / 6);
            var px = cx + Math.cos(angle) * s * 0.4;
            var py = cy + Math.sin(angle) * s * 0.4;
            ctx.beginPath();
            ctx.ellipse(px, py, s * 0.28, s * 0.16, angle, 0, Math.PI * 2);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill(); ctx.stroke();
        }

        // Center
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
    }

    function tmplButterfly(ctx, w, h) {
        var cx = w / 2, cy = h / 2;
        var s = Math.min(w, h) * 0.33;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(2, s * 0.04);
        ctx.fillStyle = '#FFFFFF';

        // Body
        ctx.beginPath();
        ctx.ellipse(cx, cy, s * 0.08, s * 0.45, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Upper left wing
        ctx.beginPath();
        ctx.ellipse(cx - s * 0.42, cy - s * 0.18, s * 0.38, s * 0.3, -0.3, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Upper right wing
        ctx.beginPath();
        ctx.ellipse(cx + s * 0.42, cy - s * 0.18, s * 0.38, s * 0.3, 0.3, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Lower left wing
        ctx.beginPath();
        ctx.ellipse(cx - s * 0.32, cy + s * 0.22, s * 0.26, s * 0.2, 0.3, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Lower right wing
        ctx.beginPath();
        ctx.ellipse(cx + s * 0.32, cy + s * 0.22, s * 0.26, s * 0.2, -0.3, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Wing circles (decorations)
        ctx.beginPath();
        ctx.arc(cx - s * 0.42, cy - s * 0.18, s * 0.12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + s * 0.42, cy - s * 0.18, s * 0.12, 0, Math.PI * 2);
        ctx.stroke();

        // Antennae
        ctx.lineWidth = Math.max(1.5, s * 0.03);
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.03, cy - s * 0.4);
        ctx.quadraticCurveTo(cx - s * 0.2, cy - s * 0.7, cx - s * 0.25, cy - s * 0.62);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.03, cy - s * 0.4);
        ctx.quadraticCurveTo(cx + s * 0.2, cy - s * 0.7, cx + s * 0.25, cy - s * 0.62);
        ctx.stroke();

        // Antennae tips
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(cx - s * 0.25, cy - s * 0.62, s * 0.04, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + s * 0.25, cy - s * 0.62, s * 0.04, 0, Math.PI * 2);
        ctx.fill();
    }

    function tmplStar(ctx, w, h) {
        var cx = w / 2, cy = h / 2;
        var s = Math.min(w, h) * 0.38;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(2, s * 0.04);
        ctx.fillStyle = '#FFFFFF';

        var spikes = 5, or_ = s, ir = s * 0.4;
        ctx.beginPath();
        for (var i = 0; i < spikes * 2; i++) {
            var r = (i % 2 === 0) ? or_ : ir;
            var a = (Math.PI * i / spikes) - Math.PI / 2;
            var x = cx + Math.cos(a) * r;
            var y = cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Cute face on star
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(cx - s * 0.15, cy - s * 0.08, s * 0.055, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + s * 0.15, cy - s * 0.08, s * 0.055, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineWidth = Math.max(1.5, s * 0.03);
        ctx.beginPath();
        ctx.arc(cx, cy + s * 0.06, s * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
    }

    function tmplCar(ctx, w, h) {
        var cx = w / 2;
        var s = Math.min(w, h) * 0.28;
        var by = h * 0.65;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(2, s * 0.05);
        ctx.fillStyle = '#FFFFFF';

        // Body
        ctx.beginPath();
        ctx.rect(cx - s * 0.95, by - s * 0.5, s * 1.9, s * 0.55);
        ctx.fill(); ctx.stroke();

        // Cabin
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.55, by - s * 0.5);
        ctx.lineTo(cx - s * 0.35, by - s * 1.05);
        ctx.lineTo(cx + s * 0.45, by - s * 1.05);
        ctx.lineTo(cx + s * 0.65, by - s * 0.5);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Left window
        ctx.fillStyle = '#E3F2FD';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.45, by - s * 0.55);
        ctx.lineTo(cx - s * 0.3, by - s * 0.95);
        ctx.lineTo(cx - s * 0.02, by - s * 0.95);
        ctx.lineTo(cx - s * 0.02, by - s * 0.55);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Right window
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.04, by - s * 0.55);
        ctx.lineTo(cx + s * 0.04, by - s * 0.95);
        ctx.lineTo(cx + s * 0.38, by - s * 0.95);
        ctx.lineTo(cx + s * 0.55, by - s * 0.55);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Wheels
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(cx - s * 0.55, by + s * 0.05, s * 0.22, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + s * 0.55, by + s * 0.05, s * 0.22, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Wheel hubs
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(cx - s * 0.55, by + s * 0.05, s * 0.07, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + s * 0.55, by + s * 0.05, s * 0.07, 0, Math.PI * 2);
        ctx.fill();

        // Headlights
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(cx - s * 0.88, by - s * 0.28, s * 0.08, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + s * 0.88, by - s * 0.28, s * 0.08, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
    }

    function tmplTree(ctx, w, h) {
        var cx = w / 2;
        var s = Math.min(w, h) * 0.28;
        var by = h * 0.78;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(2, s * 0.05);
        ctx.fillStyle = '#FFFFFF';

        // Trunk
        ctx.beginPath();
        ctx.rect(cx - s * 0.18, by - s * 0.9, s * 0.36, s * 0.9);
        ctx.fill(); ctx.stroke();

        // Crown circles
        ctx.beginPath();
        ctx.arc(cx, by - s * 1.45, s * 0.55, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx - s * 0.4, by - s * 1.05, s * 0.45, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + s * 0.4, by - s * 1.05, s * 0.45, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Apples
        ctx.fillStyle = '#FF1744';
        ctx.beginPath();
        ctx.arc(cx - s * 0.25, by - s * 1.3, s * 0.07, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + s * 0.15, by - s * 1.15, s * 0.07, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - s * 0.1, by - s * 1.0, s * 0.07, 0, Math.PI * 2);
        ctx.fill();
    }

    function tmplRocket(ctx, w, h) {
        var cx = w / 2, cy = h / 2;
        var s = Math.min(w, h) * 0.3;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = Math.max(2, s * 0.05);
        ctx.fillStyle = '#FFFFFF';

        // Body
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 1.2);
        ctx.quadraticCurveTo(cx + s * 0.4, cy - s * 0.5, cx + s * 0.35, cy + s * 0.6);
        ctx.lineTo(cx - s * 0.35, cy + s * 0.6);
        ctx.quadraticCurveTo(cx - s * 0.4, cy - s * 0.5, cx, cy - s * 1.2);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Window
        ctx.beginPath();
        ctx.arc(cx, cy - s * 0.35, s * 0.18, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Left fin
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.32, cy + s * 0.2);
        ctx.lineTo(cx - s * 0.65, cy + s * 0.75);
        ctx.lineTo(cx - s * 0.3, cy + s * 0.6);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Right fin
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.32, cy + s * 0.2);
        ctx.lineTo(cx + s * 0.65, cy + s * 0.75);
        ctx.lineTo(cx + s * 0.3, cy + s * 0.6);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Flame
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.2, cy + s * 0.6);
        ctx.quadraticCurveTo(cx - s * 0.1, cy + s * 1.0, cx, cy + s * 1.2);
        ctx.quadraticCurveTo(cx + s * 0.1, cy + s * 1.0, cx + s * 0.2, cy + s * 0.6);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Stars around
        ctx.fillStyle = '#333';
        var starPos = [
            [cx - s * 0.8, cy - s * 0.6, 3],
            [cx + s * 0.75, cy - s * 0.3, 2.5],
            [cx - s * 0.7, cy + s * 0.4, 2],
            [cx + s * 0.8, cy + s * 0.5, 2]
        ];
        for (var i = 0; i < starPos.length; i++) {
            var sp = starPos[i];
            miniStar(ctx, sp[0], sp[1], sp[2]);
        }
    }

    function miniStar(ctx, cx, cy, r) {
        ctx.beginPath();
        for (var i = 0; i < 10; i++) {
            var rad = (i % 2 === 0) ? r : r * 0.4;
            var angle = (Math.PI * i / 5) - Math.PI / 2;
            if (i === 0) ctx.moveTo(cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad);
            else ctx.lineTo(cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad);
        }
        ctx.closePath();
        ctx.fill();
    }

    function tmplRainbow(ctx, w, h) {
        var cx = w / 2;
        var by = h * 0.75;
        var s = Math.min(w, h) * 0.38;
        ctx.lineWidth = Math.max(2, s * 0.04);

        var colors = ['#FF0000', '#FF8C00', '#FFD700', '#00CC00', '#0066FF', '#4B0082', '#8B00FF'];
        var bandW = s * 0.08;

        for (var i = 0; i < colors.length; i++) {
            var r = s - i * bandW;
            if (r <= 0) break;
            ctx.strokeStyle = '#333';
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(cx, by, r, Math.PI, 0);
            ctx.stroke();
        }

        // Clouds
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#333';
        drawCloud(ctx, cx - s * 0.85, by - s * 0.05, s * 0.25);
        drawCloud(ctx, cx + s * 0.85, by - s * 0.05, s * 0.25);

        // Ground line
        ctx.beginPath();
        ctx.moveTo(cx - s * 1.1, by);
        ctx.lineTo(cx + s * 1.1, by);
        ctx.strokeStyle = '#333';
        ctx.stroke();
    }

    function drawCloud(ctx, cx, cy, s) {
        ctx.beginPath();
        ctx.arc(cx, cy, s, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx - s * 0.7, cy + s * 0.2, s * 0.7, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + s * 0.7, cy + s * 0.2, s * 0.7, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
    }

    /* ===== Bootstrap ===== */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, false);
    } else {
        init();
    }

})();
