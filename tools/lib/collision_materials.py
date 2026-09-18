"""0x417cf0 partition loader; 0x419bb0 tree walk; 0x419c80 trace material."""
import struct
def triangle_materials(raw):
 def lump(n):size,offset=struct.unpack_from('<II',raw,8+n*8);return raw[offset:offset+size]
 partitions=list(struct.iter_unpack('<HBBII',lump(33)))
 trees=list(struct.iter_unpack('<6fHHI',lump(34)));materials=lump(0);result={}
 for tree in trees:
  material,children,partition=tree[6:]
  if children:continue
  _,count,borders,first,border=partitions[partition]
  flags,contents=struct.unpack_from('<II',materials,material*72+64)
  for index in range(first,first+count):
   value=(flags,contents&0xdffffffb)
   assert index not in result or result[index]==value,('conflicting triangle material',index)
   result[index]=value
 return result
