<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.11.0" name="atlas" tilewidth="16" tileheight="16" spacing="0" margin="0" tilecount="32" columns="8">
 <image source="atlas.png" width="128" height="64"/>
 <tile id="5">
  <properties>
   <property name="collision" type="int" value="1"/>
   <property name="material" type="int" value="2"/>
   <property name="autotileGroup" value="grass"/>
  </properties>
  <animation>
   <frame tileid="5" duration="100"/>
   <frame tileid="6" duration="150"/>
  </animation>
 </tile>
</tileset>
