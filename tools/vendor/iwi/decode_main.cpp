// Standalone extraction adapter for OpenAssetTools' GPL-3.0 wavelet decoder.
#include "decoder_core.inc"
#include <fstream>
#include <iostream>
int main(int argc, char** argv) {
    if (argc != 3) return 1;
    std::ifstream in(argv[1], std::ios::binary);
    std::vector<uint8_t> bytes{std::istreambuf_iterator<char>(in), {}};
    if (bytes.size() < 28 || (bytes[4] != 6 && bytes[4] != 7)) return 2;
    const unsigned channels=bytes[4]==6 ? 4 : 3;
    const unsigned w=bytes[6]+256u*bytes[7], h=bytes[8]+256u*bytes[9];
    if (!std::has_single_bit(w) || !std::has_single_bit(h)) return 3;
    WaveletBitReader reader(std::vector<uint8_t>(bytes.begin()+28, bytes.end()));
    std::vector<uint8_t> prev;
    for (int mip=std::bit_width(std::max(w,h))-1; mip>=0; --mip) {
        unsigned mw=std::max(1u,w>>mip), mh=std::max(1u,h>>mip);
        std::vector<uint8_t> next(mw*mh*4);
        if (!DecodeWaveletLevel(prev.empty()?nullptr:prev.data(),next.data(),mw,mh,channels,4,reader)) return 4;
        prev=std::move(next);
    }
    std::ofstream out(argv[2],std::ios::binary);
    out.write(reinterpret_cast<const char*>(prev.data()),prev.size());
    return out ? 0 : 5;
}
