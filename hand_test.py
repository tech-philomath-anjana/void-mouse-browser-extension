"""Quick smoke test for the MediaPipe hand detector."""

from __future__ import annotations

import time
from pathlib import Path
from typing import List

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


MODEL_PATH = Path(__file__).resolve().parent / "hand_landmarker.task"


class handDetector:
    HAND_CONNECTIONS = (
        (0, 1), (1, 2), (2, 3), (3, 4),
        (0, 5), (5, 6), (6, 7), (7, 8),
        (5, 9), (9, 10), (10, 11), (11, 12),
        (9, 13), (13, 14), (14, 15), (15, 16),
        (13, 17), (17, 18), (18, 19), (19, 20),
        (0, 17),
    )

    def __init__(self, mode: bool = False, max_hands: int = 2, detection_confidence: float = 0.3, tracking_confidence: float = 0.3):
        self.mode = mode
        self.max_hands = max_hands
        self.detection_confidence = detection_confidence
        self.tracking_confidence = tracking_confidence

        base_options = python.BaseOptions(model_asset_path=str(MODEL_PATH))
        options = vision.HandLandmarkerOptions(
            base_options=base_options,
            num_hands=self.max_hands,
            min_hand_detection_confidence=self.detection_confidence,
            min_hand_presence_confidence=self.detection_confidence,
            min_tracking_confidence=self.tracking_confidence,
        )

        self.detector = vision.HandLandmarker.create_from_options(options)
        self.results = None

    def find_hands(self, img, draw: bool = True):
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)

        self.results = self.detector.detect(mp_image)

        if self.results.hand_landmarks and draw:
            h, w, _ = img.shape
            for hand_landmarks in self.results.hand_landmarks:
                for start_idx, end_idx in self.HAND_CONNECTIONS:
                    start = hand_landmarks[start_idx]
                    end = hand_landmarks[end_idx]
                    start_point = (int(start.x * w), int(start.y * h))
                    end_point = (int(end.x * w), int(end.y * h))
                    cv2.line(img, start_point, end_point, (139, 0, 0), 2)

                for landmark in hand_landmarks:
                    cx, cy = int(landmark.x * w), int(landmark.y * h)
                    cv2.circle(img, (cx, cy), 5, (255, 191, 0), cv2.FILLED)

        return img

    def find_position(self, img, hand_no: int = 0, draw: bool = True) -> List[List[int]]:
        landmark_list: List[List[int]] = []

        if self.results and self.results.hand_landmarks and hand_no < len(self.results.hand_landmarks):
            hand = self.results.hand_landmarks[hand_no]
            h, w, _ = img.shape

            for idx, landmark in enumerate(hand):
                cx, cy = int(landmark.x * w), int(landmark.y * h)
                landmark_list.append([idx, cx, cy])

                if draw:
                    cv2.circle(img, (cx, cy), 5, (255, 0, 255), cv2.FILLED)

        return landmark_list


def main():
    prev_time = 0.0
    cap = cv2.VideoCapture(0)

    cap.set(cv2.CAP_PROP_FPS, 30)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    detector = handDetector()

    while True:
        success, img = cap.read()
        if not success:
            print("couldn't read frame")
            continue

        img = detector.find_hands(img)
        landmarks = detector.find_position(img, draw=False)

        if landmarks:
            print(landmarks[4])

        curr_time = time.time()
        fps = 1 / (curr_time - prev_time) if prev_time else 0
        prev_time = curr_time

        cv2.putText(img, f'FPS: {int(fps)}', (10, 70), cv2.FONT_HERSHEY_PLAIN, 3, (255, 0, 255), 3)
        cv2.imshow("Hand Tracking", img)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
