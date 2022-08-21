rm -rf poncho
mkdir poncho
cd ..
sbt nativeLink
ln -s (pwd)/target/scala-3.1.3/poncho-out integration/poncho/
