#pragma once

#include <algorithm>
#include <cstdint>
#include <mutex>
#include <utility>
#include <vector>

inline int64_t resolveLoopbackPacketTimestampHns(
    int64_t reportedTimestampHns,
    int64_t readTimestampHns,
    int64_t packetDurationHns,
    int64_t streamStartHns
) {
    // GetBuffer timestamps the first sample in a packet already available to
    // read. A timestamp well ahead of the read clock would add false delay.
    constexpr int64_t toleranceHns = 100 * 10000;
    if (reportedTimestampHns <= 0 ||
        (streamStartHns > 0 && streamStartHns - reportedTimestampHns > toleranceHns) ||
        (readTimestampHns > 0 && reportedTimestampHns - readTimestampHns > toleranceHns)) {
        return readTimestampHns > packetDurationHns
            ? (std::max)(streamStartHns, readTimestampHns - packetDurationHns)
            : 0;
    }
    return reportedTimestampHns;
}

// Both capture threads map device timestamps through the same pause intervals.
class RecordingClock {
public:
    void pause(int64_t time) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (time > 0 && (pauses_.empty() ||
            (pauses_.back().second != 0 && time >= pauses_.back().second)))
            pauses_.emplace_back(time, 0);
    }

    void resume(int64_t time) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!pauses_.empty() && pauses_.back().second == 0 && time >= pauses_.back().first)
            pauses_.back().second = time;
    }

    int64_t recordingTime(int64_t time) const {
        std::lock_guard<std::mutex> lock(mutex_);
        int64_t result = time;
        for (const auto& [start, end] : pauses_) {
            if (time <= start) break;
            result -= (end == 0 ? time : (std::min)(time, end)) - start;
        }
        return result;
    }
private:
    mutable std::mutex mutex_;
    std::vector<std::pair<int64_t, int64_t>> pauses_;
};
