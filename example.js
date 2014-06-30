if (process.argv.length < 6) {
    console.log('usage: xml2json <nProcs> <XML file> <tag> <maxNTags>');
    console.log('       nProcs        - Number of parallel Node.js processes to use');
    console.log('       XML file      - Filename of XML file');
    console.log('       tag           - XML tag of the data to be converted to JSON');
    console.log('       maxNTags      - Maximum number of XML tags to be converted to JSON');
    process.exit(1);
}

var nProcs = parseInt(process.argv[2]);
var xmlFilename = process.argv[3];
var parXML2json = require('parallel-xml2json');
var ems = require('ems')(nProcs, false, 'fj');

//  Parse the XML file in parallel and return the EMS descriptor
//  other programs use to map this EMS file into memory.
var emsParams = parXML2json.parseAll(
    ems,                                  // Global EMS object
    nProcs,                               // Number of processes
    xmlFilename,                          // XML input Filename
    xmlFilename.replace('.xml', '.ems'),  // EMS output filename
    process.argv[4],             // XML tag to create JSON object for
    parseInt(process.argv[5]),   // Maximum number of XML tag-data objects
    2000000,           // Largest filesystem read operation (in bytes)
    10000);            // Length of longest possible XML tag-data object

// Print the EMS descriptor for future programs to use
console.log('EMS descriptor:' + JSON.stringify(emsParams));


// Ordinary sequential loop to skip through some of the JSON records.
// All work is performed using only the master thread.
for(var idx = 0;  idx < emsParams.nRecords;  idx += Math.floor(emsParams.nRecords/3) ) {
    console.log('serial readback: ', idx, XML2jsonEMS.read(idx) )
}

//  An EMS fork-join parallel region performs this function
//  once on every EMS worker process
ems.parallel( function() {
    //  Parallel loop, iterations are distributed across tasks.
    //  The only purpose of static scheduling is to illustrate all threads
    //  having an iteration
    ems.parForEach(0, ems.nThreads, function (idx) {
        ems.diag('par readback' + idx + '  ' + JSON.stringify(XML2jsonEMS.readFF(idx)));
    }, 'static');
});

process.exit(0);
