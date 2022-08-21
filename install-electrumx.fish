rm -rf electrumx
git clone https://github.com/spesmilo/electrumx.git
cd electrumx
python3 -m venv venv
./venv/bin/python3 setup.py install
