import cv2
import math
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import time


class handDetector:
    def __init__(self, mode=False, max_hands=2, detection_confidence=0.3, tracking_confidence=0.3):
        self.mode = mode
        self.max_hands = max_hands
        self.detection_confidence = detection_confidence
        self.tracking_confidence = tracking_confidence

        # landmark connection pairs for drawing hand skeleton
        self.HAND_CONNECTIONS = [
            (0, 1), (1, 2), (2, 3), (3, 4),
            (0, 5), (5, 6), (6, 7), (7, 8),
            (5, 9), (9, 10), (10, 11), (11, 12),
            (9, 13), (13, 14), (14, 15), (15, 16),
            (13, 17), (17, 18), (18, 19), (19, 20),
            (0, 17)
        ]

        base_options = python.BaseOptions(model_asset_path='hand_landmarker.task')
        options = vision.HandLandmarkerOptions(
            base_options=base_options,
            num_hands=self.max_hands,
            min_hand_detection_confidence=self.detection_confidence,
            min_hand_presence_confidence=self.detection_confidence,
            min_tracking_confidence=self.tracking_confidence
        )

        self.detector = vision.HandLandmarker.create_from_options(options)
        self.results = None

    def findHands(self, img, draw=True):
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)

        self.results = self.detector.detect(mp_image)

        if self.results.hand_landmarks and draw:
            h, w, c = img.shape

            for hand_landmarks in self.results.hand_landmarks:
                # draw lines between joints
                for connection in self.HAND_CONNECTIONS:
                    start = hand_landmarks[connection[0]]
                    end = hand_landmarks[connection[1]]
                    start_point = (int(start.x * w), int(start.y * h))
                    end_point = (int(end.x * w), int(end.y * h))
                    cv2.line(img, start_point, end_point, (139, 0, 0), 2)

                # draw circles at landmarks
                for landmark in hand_landmarks:
                    cx, cy = int(landmark.x * w), int(landmark.y * h)
                    cv2.circle(img, (cx, cy), 5, (255, 191, 0), cv2.FILLED)

        return img

    def findPosition(self, img, hand_no=0, draw=True):
        landmark_list = []
        bbox = []

        if self.results and self.results.hand_landmarks:
            if hand_no < len(self.results.hand_landmarks):
                hand = self.results.hand_landmarks[hand_no]
                h, w, c = img.shape
                x_list, y_list = [], []

                for idx, landmark in enumerate(hand):
                    cx, cy = int(landmark.x * w), int(landmark.y * h)
                    landmark_list.append([idx, cx, cy])
                    x_list.append(cx)
                    y_list.append(cy)

                    if draw:
                        cv2.circle(img, (cx, cy), 5, (255, 0, 255), cv2.FILLED)

                # calculate bounding box around hand
                if x_list and y_list:
                    x_min, x_max = min(x_list), max(x_list)
                    y_min, y_max = min(y_list), max(y_list)
                    bbox = [x_min, y_min, x_max, y_max]

        return landmark_list, bbox

    def fingersUp(self):
        fingers = []
        tip_ids = [4, 8, 12, 16, 20]

        if self.results and self.results.hand_landmarks:
            hand = self.results.hand_landmarks[0]
            landmarks = list(hand)

            # thumb is special - check horizontal position
            if len(landmarks) > 0:
                if landmarks[tip_ids[0]].x > landmarks[tip_ids[0] - 1].x:
                    fingers.append(1)
                else:
                    fingers.append(0)

            # other fingers - check if tip is above the joint below it
            for i in range(1, 5):
                if landmarks[tip_ids[i]].y < landmarks[tip_ids[i] - 2].y:
                    fingers.append(1)
                else:
                    fingers.append(0)
        else:
            fingers = [0, 0, 0, 0, 0]

        return fingers

    def findDistance(self, p1, p2, img, draw=True):
        if self.results and self.results.hand_landmarks:
            hand = self.results.hand_landmarks[0]
            h, w, c = img.shape

            x1, y1 = int(hand[p1].x * w), int(hand[p1].y * h)
            x2, y2 = int(hand[p2].x * w), int(hand[p2].y * h)
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2

            if draw:
                cv2.circle(img, (x1, y1), 10, (255, 0, 255), cv2.FILLED)
                cv2.circle(img, (x2, y2), 10, (255, 0, 255), cv2.FILLED)
                cv2.line(img, (x1, y1), (x2, y2), (255, 0, 255), 3)
                cv2.circle(img, (cx, cy), 10, (255, 0, 255), cv2.FILLED)

            length = math.hypot(x2 - x1, y2 - y1)
            return length, img, [x1, y1, x2, y2, cx, cy]

        return 0, img, [0, 0, 0, 0, 0, 0]


def main():
    prev_time = 0
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

        img = detector.findHands(img)
        landmarks, bbox = detector.findPosition(img, draw=False)

        if len(landmarks) != 0:
            print(landmarks[4])

        curr_time = time.time()
        fps = 1 / (curr_time - prev_time)
        prev_time = curr_time

        cv2.putText(img, f'FPS: {int(fps)}', (10, 70),
                    cv2.FONT_HERSHEY_PLAIN, 3, (255, 0, 255), 3)

        cv2.imshow("Hand Tracking", img)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()

