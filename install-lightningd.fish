rm -rf lightning
git clone https://github.com/elementsproject/lightning
cd lightning
poetry install
./configure --enable-developer
make
