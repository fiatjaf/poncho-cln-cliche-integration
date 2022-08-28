git clone https://github.com/fiatjaf/poncho
cd poncho
sbt nativeLink
ln -s (pwd)/target/scala-3.1.3/poncho-out ./
