import cv2
import numpy as np
import hand_tracker as htm
import time
import pyautogui

# camera and tracking settings
CAM_WIDTH, CAM_HEIGHT = 1280, 720
SMOOTHING = 7
CLICK_THRESHOLD = 50
SCROLL_FRAME_DELAY = 3

# state variables
prev_time = 0
prev_x, prev_y = 0, 0
curr_x, curr_y = 0, 0
click_cooldown = 0
scroll_counter = 0

# find available camera
cap = None
for i in range(2):
    temp_cap = cv2.VideoCapture(i)
    if temp_cap.isOpened():
        cap = temp_cap
        break
    temp_cap.release()

if cap is None:
    raise Exception("no camera found")

cap.set(3, CAM_WIDTH)
cap.set(4, CAM_HEIGHT)
detector = htm.handDetector(max_hands=1)
screen_w, screen_h = pyautogui.size()
pyautogui.FAILSAFE = False

while True:
    success, img = cap.read()
    img = detector.findHands(img)
    landmarks, bbox = detector.findPosition(img)

    # get finger tip positions
    if len(landmarks) != 0:
        x1, y1 = landmarks[8][1:]  # index finger tip
        x2, y2 = landmarks[12][1:]  # middle finger tip

    fingers = detector.fingersUp()

    if click_cooldown > 0:
        click_cooldown -= 1

    # thumb only = scroll
    if fingers[0] == 1 and fingers[1] == 0 and fingers[2] == 0 and fingers[3] == 0 and fingers[4] == 0:
        thumb_tip_y = landmarks[4][2]
        thumb_base_y = landmarks[2][2]

        scroll_counter += 1
        if scroll_counter >= SCROLL_FRAME_DELAY:
            if thumb_tip_y < thumb_base_y:  # thumbs up
                pyautogui.scroll(3)
                cv2.putText(img, "SCROLL UP", (50, 100), cv2.FONT_HERSHEY_PLAIN, 2,
                            (0, 255, 0), 3)
            else:  # thumbs down
                pyautogui.scroll(-3)
                cv2.putText(img, "SCROLL DOWN", (50, 100), cv2.FONT_HERSHEY_PLAIN, 2,
                            (0, 0, 255), 3)
            scroll_counter = 0
        click_cooldown = 10

    # index + middle finger = click mode
    elif fingers[1] == 1 and fingers[2] == 1:
        scroll_counter = 0
        length, img, line_info = detector.findDistance(8, 12, img)

        # pinch to click
        if length < CLICK_THRESHOLD and click_cooldown == 0:
            cv2.circle(img, (line_info[4], line_info[5]),
                       15, (0, 255, 0), cv2.FILLED)
            pyautogui.click()
            click_cooldown = 15
        else:
            cv2.line(img, (line_info[0], line_info[1]), (line_info[2], line_info[3]),
                    (255, 0, 255), 3)

    # index finger only = move cursor
    elif fingers[1] == 1 and fingers[2] == 0:
        scroll_counter = 0
        click_cooldown = 0

        # map camera coords to screen coords
        x3 = np.interp(x1, (50, CAM_WIDTH - 50), (0, screen_w))
        y3 = np.interp(y1, (50, CAM_HEIGHT - 50), (0, screen_h))

        # smooth out movement
        curr_x = prev_x + (x3 - prev_x) / SMOOTHING
        curr_y = prev_y + (y3 - prev_y) / SMOOTHING

        pyautogui.moveTo(screen_w - curr_x, curr_y)
        cv2.circle(img, (x1, y1), 15, (255, 0, 255), cv2.FILLED)
        prev_x, prev_y = curr_x, curr_y

    # show fps
    curr_time = time.time()
    fps = 1 / (curr_time - prev_time)
    prev_time = curr_time
    cv2.putText(img, str(int(fps)), (20, 50), cv2.FONT_HERSHEY_PLAIN, 3,
                (255, 0, 0), 3)

    cv2.imshow("Image", img)
    cv2.waitKey(1)