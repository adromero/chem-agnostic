package element

type JobId struct {
	Value string
}

func NewJobId(v string) JobId {
	return JobId{Value: v}
}
