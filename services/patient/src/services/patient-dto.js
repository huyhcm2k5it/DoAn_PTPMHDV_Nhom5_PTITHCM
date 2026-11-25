function patientDto(patient) {
  if (!patient) return null;
  const { _id, ...data } = patient;
  if (data.birthDate instanceof Date)
    data.birthDate = data.birthDate.toISOString().slice(0, 10);
  return data;
}
module.exports = { patientDto };
