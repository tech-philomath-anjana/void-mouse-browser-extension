"""Simple gesture-controlled mouse using MediaPipe landmarks.

The gestures are intentionally minimal: one finger moves the cursor,
a pinch clicks, and a thumb-only pose scrolls.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np
import pyautogui

import hand_tracker as htm


CAM_WIDTH, CAM_HEIGHT = 1280, 720
SMOOTHING = 7
CLICK_THRESHOLD = 50
SCROLL_FRAME_DELAY = 3


@dataclass
class CursorState:
    prev_x: float = 0
    prev_y: float = 0
    cooldown_frames: int = 0
    scroll_counter: int = 0
    fps_time: float = 0


def find_camera(max_index: int = 1) -> cv2.VideoCapture:
    """Return the first opened camera up to max_index (inclusive)."""

    for idx in range(max_index + 1):
        capture = cv2.VideoCapture(idx)
        if capture.isOpened():
            return capture
        capture.release()
    raise RuntimeError("No camera found")


def draw_status(text: str, frame, color=(0, 255, 0)) -> None:
    cv2.putText(frame, text, (50, 100), cv2.FONT_HERSHEY_PLAIN, 2, color, 3)


def map_to_screen(x: float, y: float, screen_w: int, screen_h: int) -> Tuple[float, float]:
    x_screen = np.interp(x, (50, CAM_WIDTH - 50), (0, screen_w))
    y_screen = np.interp(y, (50, CAM_HEIGHT - 50), (0, screen_h))
    return x_screen, y_screen


def handle_scroll(landmarks, state: CursorState) -> None:
    thumb_tip_y = landmarks[4][2]
    thumb_base_y = landmarks[2][2]

    state.scroll_counter += 1
    if state.scroll_counter < SCROLL_FRAME_DELAY:
        return

    direction = 3 if thumb_tip_y < thumb_base_y else -3
    pyautogui.scroll(direction)
    state.scroll_counter = 0
    state.cooldown_frames = 10


def handle_click(detector, frame, state: CursorState) -> None:
    length, frame, line_info = detector.findDistance(8, 12, frame)
    if length < CLICK_THRESHOLD and state.cooldown_frames == 0:
        cv2.circle(frame, (line_info[4], line_info[5]), 15, (0, 255, 0), cv2.FILLED)
        pyautogui.click()
        state.cooldown_frames = 15
    else:
        cv2.line(frame, (line_info[0], line_info[1]), (line_info[2], line_info[3]), (255, 0, 255), 3)


def handle_move(landmarks, detector, screen_w: int, screen_h: int, state: CursorState, frame) -> None:
    x1, y1 = landmarks[8][1:]
    mapped_x, mapped_y = map_to_screen(x1, y1, screen_w, screen_h)

    curr_x = state.prev_x + (mapped_x - state.prev_x) / SMOOTHING
    curr_y = state.prev_y + (mapped_y - state.prev_y) / SMOOTHING

    pyautogui.moveTo(screen_w - curr_x, curr_y)
    cv2.circle(frame, (x1, y1), 15, (255, 0, 255), cv2.FILLED)
    state.prev_x, state.prev_y = curr_x, curr_y


def main() -> None:
    cap = find_camera()
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAM_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_HEIGHT)

    detector = htm.handDetector(max_hands=1)
    screen_w, screen_h = pyautogui.size()
    pyautogui.FAILSAFE = False

    state = CursorState()

    while True:
        success, frame = cap.read()
        if not success:
            continue

        frame = detector.findHands(frame)
        landmarks, _ = detector.findPosition(frame)
        fingers = detector.fingersUp()

        if state.cooldown_frames > 0:
            state.cooldown_frames -= 1

        if landmarks:
            # Thumb only → scroll
            if fingers == [1, 0, 0, 0, 0]:
                handle_scroll(landmarks, state)
            # Index + middle → pinch click
            elif fingers[1] == 1 and fingers[2] == 1:
                state.scroll_counter = 0
                handle_click(detector, frame, state)
            # Index only → move cursor
            elif fingers[1] == 1 and fingers[2] == 0:
                state.scroll_counter = 0
                state.cooldown_frames = 0
                handle_move(landmarks, detector, screen_w, screen_h, state, frame)

        # HUD: FPS
        now = time.time()
        fps = 1 / (now - state.fps_time) if state.fps_time else 0
        state.fps_time = now
        cv2.putText(frame, f"{int(fps)}", (20, 50), cv2.FONT_HERSHEY_PLAIN, 3, (255, 0, 0), 3)

        cv2.imshow("Image", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()