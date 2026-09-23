// tracky_mouse_gestures.js — VENDORED, not written here.
//
// Source: https://github.com/1j01/tracky-mouse, `core/src/gestures.js` (+ the one function it
// needs from `core/src/utils.js`, inlined below rather than vendoring that whole file too — see
// `input_facegesture.js`'s own header for why this exists at all and what it plugs into).
//
// Author: Isaiah Odhner. Licence: MIT, Copyright (c) 2021 Isaiah Odhner. Verified via GitHub's
// own license API 2026-09-23 (`api.github.com/repos/1j01/tracky-mouse/license` -> "mit").
// Fetched from `main` the same day; ATTRIBUTIONS.md carries the same date and the commit this
// was read at.
//
// CHANGES from upstream, and nothing else: `signedDistancePointLine` inlined (upstream imports
// it from `./utils.js`, a file this project has no other use for beyond that one function); this
// header; and upstream's long exploratory/TODO comments on blink-detection research trimmed for
// length (the CODE is verbatim, including the numbers — see upstream's own history for the
// research notes, since this file did not need to carry them to stay correct). Do not otherwise
// hand-edit — pull a fresh copy from upstream instead, the same rule livescene.js's own header
// states for a different vendored/generated file.

// -- from core/src/utils.js --

/** Returns the distance between a point and a line defined by two points, with the sign indicating which side of the line the point is on */
function signedDistancePointLine(point, a, b) {
	const [px, py] = point;
	const [x1, y1] = a;
	const [x2, y2] = b;

	const dx = x2 - x1;
	const dy = y2 - y1;

	// Perpendicular (normal) vector
	const nx = -dy;
	const ny = dx;

	return ((px - x1) * nx + (py - y1) * ny) / Math.hypot(nx, ny);
}

// -- from core/src/gestures.js --

function getAspectMetrics(upperContour, lowerContour) {
	// The lower eye keypoints have the corners
	const corners = [lowerContour[0], lowerContour[lowerContour.length - 1]];
	// Excluding the corners isn't really important since their measures will be 0.
	const otherPoints = upperContour.concat(lowerContour).filter(point => !corners.includes(point));
	let highest = 0;
	let lowest = 0;
	for (const point of otherPoints) {
		const distance = signedDistancePointLine(point, corners[0], corners[1]);
		if (distance < lowest) {
			lowest = distance;
		}
		if (distance > highest) {
			highest = distance;
		}
	}

	const width = Math.hypot(
		corners[0][0] - corners[1][0],
		corners[0][1] - corners[1][1]
	);
	const height = highest - lowest;
	return {
		corners,
		upperContour,
		lowerContour,
		highest,
		lowest,
		heightRatio: height / width,
	};
}

function detectBlinks(annotations, blinkInfo) {
	// Note: currently head tilt matters a lot, but ideally it should not.
	// - When moving closer to the camera, theoretically the eye size to head size ratio increases.
	//   (if you can hold your eye still, you can test by moving nearer to / further from the camera (or moving the camera))
	// - When tilting your head left or right, the contour of one closed eyelid becomes more curved* (as it wraps around your head),
	//   while the other stays near center of the visual region of your head and thus stays relatively straight (experiencing less projection distortion).
	// - When tilting your head down, the contour of a closed eyelid becomes more curved, which can lead to false negatives.
	// - When tilting your head up, the contour of an open eyelid becomes more straight, which can lead to false positives.
	// - *This is a geometric explanation, but in practice, facemesh loses the ability to detect
	//   whether the eye is closed when the head is tilted beyond a point.
	//   Enable `showDebugEyeZoom` to see the shapes we're dealing with here.
	// - Facemesh uses an "attention mesh model", enabled with `refineLandmarks: true`,
	//   which adjusts points near the eyes and lips to be more accurate (and is 100% necessary for this blink detection to work).
	//   This is what we might ideally target to improve blink detection.

	const eyes = {
		leftEye: getAspectMetrics(annotations.leftEyeUpper0, annotations.leftEyeLower0),
		rightEye: getAspectMetrics(annotations.rightEyeUpper0, annotations.rightEyeLower0)
	};

	const thresholdHigh = 0.2;
	const thresholdLow = 0.16;
	for (const key of ["leftEye", "rightEye"]) {
		eyes[key].open = eyes[key].heightRatio > (blinkInfo?.[key].open ? thresholdLow : thresholdHigh);
	}

	// Involuntary blink rejection
	const blinkRejectDuration = 100; // milliseconds
	const currentTime = performance.now();
	for (const key of ["leftEye", "rightEye"]) {
		if (eyes[key].open === blinkInfo?.[key].open) {
			eyes[key].timeSinceChange = blinkInfo?.[key].timeSinceChange ?? currentTime;
		} else {
			eyes[key].timeSinceChange = currentTime;
		}
	}
	const timeSinceChange = currentTime - Math.max(eyes.leftEye.timeSinceChange, eyes.rightEye.timeSinceChange);
	eyes.leftEye.active = timeSinceChange > blinkRejectDuration && eyes.rightEye.open && !eyes.leftEye.open;
	eyes.rightEye.active = timeSinceChange > blinkRejectDuration && eyes.leftEye.open && !eyes.rightEye.open;

	eyes.leftEye.thresholdMet = !eyes.leftEye.open;
	eyes.rightEye.thresholdMet = !eyes.rightEye.open;

	return eyes;
}

function detectMouthOpen(annotations, mouthInfo) {
	const prevThresholdMet = mouthInfo?.thresholdMet;
	const mouth = getAspectMetrics(annotations.lipsUpperInner, annotations.lipsLowerInner);
	const thresholdHigh = 0.25;
	const thresholdLow = 0.15;
	mouth.thresholdMet = mouth.heightRatio > (prevThresholdMet ? thresholdLow : thresholdHigh);
	mouth.active = mouth.thresholdMet; // TODO: maybe default to false, have this only set externally in gesture handling code
	return mouth;
}

export function detectGestures({
	// Input + Output state
	blinkInfo, mouthInfo, sleepGestureProgress, sleepGestureEyesClosedDuration, mouseButtonUntilMouthCloses,
	// Input only
	annotations, s, deltaTime
}) {
	// Output only
	let sleepGestureTriggered = false;
	let clickButton = -1;


	const prevMouthOpen = mouthInfo?.thresholdMet;

	blinkInfo = detectBlinks(annotations, blinkInfo);
	mouthInfo = detectMouthOpen(annotations, mouthInfo);
	if (!blinkInfo.rightEye.open && !blinkInfo.leftEye.open) {
		sleepGestureProgress += deltaTime / sleepGestureEyesClosedDuration;
		sleepGestureProgress = Math.min(sleepGestureProgress, 1);
	} else {
		sleepGestureProgress -= deltaTime / sleepGestureEyesClosedDuration;
		sleepGestureProgress = Math.max(sleepGestureProgress, 0);
	}
	if (sleepGestureProgress >= 1) {
		sleepGestureProgress = 0;
		if (s.closeEyesToToggle) {
			sleepGestureTriggered = true;
		}
	}

	blinkInfo.used = false;
	mouthInfo.used = false;
	if (s.clickingMode === "blink") {
		blinkInfo.used = true;
		if (blinkInfo.rightEye.active) {
			clickButton = 0;
		} else if (blinkInfo.leftEye.active) {
			clickButton = 2;
		}
	}
	if (s.clickingMode === "open-mouth-ignoring-eyes") {
		mouthInfo.used = true;
		if (mouthInfo.thresholdMet) {
			clickButton = 0;
		}
	}
	if (s.clickingMode === "open-mouth" || s.clickingMode === "open-mouth-simple") {
		mouthInfo.used = true;
		blinkInfo.used = true;
		const allowModifiers = s.clickingMode !== "open-mouth-simple";
		// Modifiers with eye closing trigger different buttons,
		// making this a three-button mouse.
		// Keep same button held if eye is opened,
		// so you can continue to scroll a webpage without trying to
		// read with one eye closed (for example).
		if (mouthInfo.thresholdMet && !prevMouthOpen) {
			if (blinkInfo.rightEye.active && allowModifiers) {
				mouseButtonUntilMouthCloses = 1;
			} else if (blinkInfo.leftEye.active && allowModifiers) {
				mouseButtonUntilMouthCloses = 2;
			} else if (!blinkInfo.rightEye.open && !blinkInfo.leftEye.open) {
				mouseButtonUntilMouthCloses = -1;
			} else {
				mouseButtonUntilMouthCloses = 0;
			}
		}
		if (mouthInfo.thresholdMet) {
			clickButton = mouseButtonUntilMouthCloses;
			if (clickButton === -1) {
				// Show as passive / not clicking in visuals
				mouthInfo.active = false;
			}
		}
		if (mouthInfo.thresholdMet || s.clickingMode === "open-mouth-simple") {
			blinkInfo.rightEye.active = clickButton === 1;
			blinkInfo.leftEye.active = clickButton === 2;
		}
	}

	return { blinkInfo, mouthInfo, sleepGestureProgress, sleepGestureEyesClosedDuration, mouseButtonUntilMouthCloses, sleepGestureTriggered, clickButton };
}
