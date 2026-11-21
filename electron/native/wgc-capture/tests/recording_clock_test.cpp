#include "../src/audio_timing.h"

int main() {
    RecordingClock clock;
    constexpr int64_t ms = 10000;
    constexpr int64_t firstFrame = 1000 * ms;
    clock.pause(firstFrame + 30 * ms);
    clock.resume(firstFrame + 3039 * ms);
    const auto offset = [&](int64_t timestamp) {
        return clock.recordingTime(timestamp) - clock.recordingTime(firstFrame);
    };
    if (offset(firstFrame + 4145 * ms) != 1136 * ms) return 1;
    if (offset(firstFrame + 20 * ms) != 20 * ms) return 2;
    clock.pause(firstFrame + 5000 * ms);
    if (offset(firstFrame + 6000 * ms) != 1991 * ms) return 3;
    clock.resume(firstFrame + 6500 * ms);
    if (offset(firstFrame + 6700 * ms) != 2191 * ms) return 4;
    // Re-reading an old packet after another pause must give its original time.
    if (offset(firstFrame + 4145 * ms) != 1136 * ms) return 5;
    if (clock.recordingTime(firstFrame + 6700 * ms) -
        clock.recordingTime(firstFrame + 4145 * ms) != 1055 * ms) return 6;
    clock.pause(firstFrame + 7000 * ms);
    clock.pause(firstFrame + 7100 * ms); // duplicate pause
    clock.resume(firstFrame + 6900 * ms); // stale resume
    if (offset(firstFrame + 7200 * ms) != 2491 * ms) return 7;
    clock.resume(firstFrame + 7500 * ms);
    clock.pause(firstFrame + 6800 * ms); // stale pause after resume
    if (offset(firstFrame + 7600 * ms) != 2591 * ms) return 8;

    const int64_t start = 10000 * ms;
    const int64_t read = start + 200 * ms;
    const int64_t packet = 10 * ms;
    if (resolveLoopbackPacketTimestampHns(start - 9000 * ms, read, packet, start) != read - packet) return 9;
    if (resolveLoopbackPacketTimestampHns(read + 3000 * ms, read, packet, start) != read - packet) return 10;
    if (resolveLoopbackPacketTimestampHns(0, start + ms, packet, start) != start) return 11;
    if (resolveLoopbackPacketTimestampHns(start - 9000 * ms, 0, packet, start) != 0) return 12;
    if (resolveLoopbackPacketTimestampHns(read - packet, read, packet, start) != read - packet) return 13;
    return 0;
}
